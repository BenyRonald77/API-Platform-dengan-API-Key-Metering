import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { redisConnection } from "../src/lib/redis-connection";
import { generateApiKey, hashApiKey } from "../src/lib/api-key";
import { getPlanConfig } from "../src/lib/plans";
import { currentYearMonth } from "../src/lib/usage-service";
import { generateInvoiceForUser } from "../src/lib/billing-service";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "verify-pro@platform.dev" },
    update: { plan: "PRO" },
    create: { name: "Verify Pro", email: "verify-pro@platform.dev", passwordHash: "x", plan: "PRO" },
  });

  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  const { key, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { userId: user.id, keyHash: hashApiKey(key), keyPrefix: prefix, name: "pro-test" },
  });

  const proConfig = getPlanConfig("PRO");
  const yearMonth = currentYearMonth();

  // Set usage sudah melewati kuota Pro sebanyak 2500 request (overage).
  const overage = 2500;
  await prisma.monthlyUsage.create({
    data: { apiKeyId: apiKey.id, yearMonth, count: proConfig.monthlyQuota + overage },
  });

  const minuteBucket = Math.floor(Date.now() / 60000);
  await redisConnection.del(`ratelimit:${apiKey.id}:${minuteBucket}`);

  console.log(`[verify] Usage Pro di-set ${proConfig.monthlyQuota + overage} (${overage} di atas kuota). Memanggil /api/v1/ping...`);
  const response = await fetch(`${SERVER_URL}/api/v1/ping`, { headers: { "X-Api-Key": key } });
  const body = await response.json();
  console.log(`[verify] HTTP ${response.status}`, body);

  if (response.status !== 200) {
    throw new Error(`GAGAL: request Pro yang melewati kuota seharusnya TETAP diproses (200, soft cap), didapat ${response.status}`);
  }
  console.log("[verify] BERHASIL: request Pro tetap diproses meski sudah melewati kuota (soft cap, bukan hard block).");

  const invoice = await generateInvoiceForUser(user.id, yearMonth);
  console.log("[verify] Invoice digenerate:", {
    totalRequests: invoice.totalRequests,
    includedRequests: invoice.includedRequests,
    overageRequests: invoice.overageRequests,
    baseCost: invoice.baseCost,
    overageCost: invoice.overageCost,
    totalCost: invoice.totalCost,
  });

  const expectedOverageRequests = overage + 1; // +1 dari request ping yang baru saja masuk
  const expectedOverageCost = Math.ceil(expectedOverageRequests / 1000) * proConfig.overagePricePer1000;
  const expectedTotalCost = proConfig.basePrice + expectedOverageCost;

  if (invoice.overageRequests !== expectedOverageRequests) {
    throw new Error(`GAGAL: overageRequests seharusnya ${expectedOverageRequests}, didapat ${invoice.overageRequests}`);
  }
  if (invoice.totalCost !== expectedTotalCost) {
    throw new Error(`GAGAL: totalCost seharusnya ${expectedTotalCost}, didapat ${invoice.totalCost}`);
  }

  console.log(
    `[verify] BERHASIL: tagihan overage dihitung benar - ${expectedOverageRequests} request kelebihan -> Rp${expectedOverageCost.toLocaleString("id-ID")} biaya overage, total tagihan Rp${expectedTotalCost.toLocaleString("id-ID")}.`
  );

  await prisma.invoice.deleteMany({ where: { userId: user.id } });
  await prisma.requestLog.deleteMany({ where: { apiKeyId: apiKey.id } });
  await prisma.monthlyUsage.deleteMany({ where: { apiKeyId: apiKey.id } });
  await prisma.apiKey.delete({ where: { id: apiKey.id } });
  await prisma.$disconnect();
  redisConnection.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});

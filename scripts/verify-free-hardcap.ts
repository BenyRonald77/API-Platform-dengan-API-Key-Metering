import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { redisConnection } from "../src/lib/redis-connection";
import { generateApiKey, hashApiKey } from "../src/lib/api-key";
import { getPlanConfig } from "../src/lib/plans";
import { currentYearMonth } from "../src/lib/usage-service";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "verify-hardcap@platform.dev" },
    update: { plan: "FREE" },
    create: { name: "Verify HardCap", email: "verify-hardcap@platform.dev", passwordHash: "x", plan: "FREE" },
  });

  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  const { key, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { userId: user.id, keyHash: hashApiKey(key), keyPrefix: prefix, name: "hardcap-test" },
  });

  const quota = getPlanConfig("FREE").monthlyQuota;
  const yearMonth = currentYearMonth();

  // Set usage tepat 1 di bawah kuota, supaya request berikutnya via HTTP
  // adalah yang PAS menyentuh batas, dan request setelah itu PASTI ditolak.
  await prisma.monthlyUsage.create({ data: { apiKeyId: apiKey.id, yearMonth, count: quota - 1 } });

  const minuteBucket = Math.floor(Date.now() / 60000);
  await redisConnection.del(`ratelimit:${apiKey.id}:${minuteBucket}`);

  console.log(`[verify] Usage di-set ke ${quota - 1}/${quota}. Memanggil /api/v1/ping via HTTP sungguhan...`);

  const res1 = await fetch(`${SERVER_URL}/api/v1/ping`, { headers: { "X-Api-Key": key } });
  const body1 = await res1.json();
  console.log(`[verify] Request ke-${quota} (tepat di batas kuota): HTTP ${res1.status}`, body1);

  const res2 = await fetch(`${SERVER_URL}/api/v1/ping`, { headers: { "X-Api-Key": key } });
  const body2 = await res2.json();
  console.log(`[verify] Request ke-${quota + 1} (melewati kuota): HTTP ${res2.status}`, body2);

  if (res1.status !== 200) {
    throw new Error(`GAGAL: request tepat di batas kuota seharusnya masih 200, didapat ${res1.status}`);
  }
  if (res2.status !== 429) {
    throw new Error(`GAGAL: request melewati kuota seharusnya 429, didapat ${res2.status}`);
  }

  console.log(
    "[verify] BERHASIL: request tepat di batas kuota (200) tetap diproses, request pertama yang melewati kuota langsung diblokir (429) - hard cap Free bekerja presisi lewat endpoint HTTP sungguhan."
  );

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

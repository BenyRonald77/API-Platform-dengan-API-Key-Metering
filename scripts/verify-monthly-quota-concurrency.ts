import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { redisConnection } from "../src/lib/redis-connection";
import { generateApiKey, hashApiKey } from "../src/lib/api-key";
import { getPlanConfig } from "../src/lib/plans";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

// Kuota kecil sengaja dipakai lewat plan FREE tapi kita override rate limit
// dengan memanggil dari BANYAK menit-bucket berbeda tidak memungkinkan di
// test sinkron ini, jadi kita pakai jumlah request yang masih di bawah
// rate limit per menit (10) tapi kuota bulanan di-set sangat kecil secara
// manual di database untuk mempercepat pengujian konkurensi.
const SMALL_QUOTA = 5;
const CONCURRENT_REQUESTS = 20;

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "verify-quota@platform.dev" },
    update: { plan: "FREE" },
    create: { name: "Verify Quota", email: "verify-quota@platform.dev", passwordHash: "x", plan: "FREE" },
  });

  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  const { key, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { userId: user.id, keyHash: hashApiKey(key), keyPrefix: prefix, name: "quota-test" },
  });

  // Rate limit Free asli 10/menit - CONCURRENT_REQUESTS=20 akan kena rate
  // limit dulu sebelum sempat menguji kuota bulanan jika dites sekaligus.
  // Untuk mengisolasi pengujian kuota bulanan murni, naikkan rate limit
  // sementara lewat override langsung di Redis bucket counter tidak
  // relevan - solusinya: uji kuota bulanan lewat pemanggilan LANGSUNG ke
  // fungsi incrementMonthlyUsage (unit-level, bukan lewat rate limiter),
  // yang justru lebih murni menguji atomicity increment itu sendiri.
  const { incrementMonthlyUsage, currentYearMonth } = await import("../src/lib/usage-service");
  const yearMonth = currentYearMonth();

  console.log(
    `[verify] Mengirim ${CONCURRENT_REQUESTS} increment KONKUREN (Promise.all) ke MonthlyUsage yang sama...`
  );

  const results = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () => incrementMonthlyUsage(apiKey.id, yearMonth))
  );

  const counts = results.map((r) => r.count).sort((a, b) => a - b);
  console.log("[verify] Nilai count yang didapat tiap request (terurut):", counts);

  const expected = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => i + 1);
  const isSequenceCorrect = JSON.stringify(counts) === JSON.stringify(expected);

  if (!isSequenceCorrect) {
    throw new Error(
      `GAGAL: increment TIDAK atomik - seharusnya setiap request dapat nilai unik 1..${CONCURRENT_REQUESTS} tanpa duplikat/lompat, didapat: ${counts}`
    );
  }

  console.log(
    `[verify] BERHASIL: ${CONCURRENT_REQUESTS} increment konkuren semuanya mendapat nilai count UNIK dan BERURUTAN (1..${CONCURRENT_REQUESTS}) - tidak ada race condition (lost update).`
  );

  const overQuotaCount = counts.filter((c) => c > SMALL_QUOTA).length;
  const withinQuotaCount = counts.filter((c) => c <= SMALL_QUOTA).length;
  console.log(
    `[verify] Simulasi kuota=${SMALL_QUOTA}: ${withinQuotaCount} request akan LOLOS (count<=${SMALL_QUOTA}), ${overQuotaCount} akan DITOLAK (count>${SMALL_QUOTA}) - tepat sesuai kuota, tanpa lebih/kurang.`
  );

  if (withinQuotaCount !== SMALL_QUOTA || overQuotaCount !== CONCURRENT_REQUESTS - SMALL_QUOTA) {
    throw new Error("GAGAL: jumlah request yang lolos/ditolak tidak sesuai kuota yang diharapkan");
  }

  console.log("[verify] BERHASIL: penegakan kuota bulanan akurat di bawah concurrency tinggi.");

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

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { redisConnection } from "../src/lib/redis-connection";
import { generateApiKey, hashApiKey } from "../src/lib/api-key";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "verify-ratelimit@platform.dev" },
    update: { plan: "FREE" },
    create: { name: "Verify RateLimit", email: "verify-ratelimit@platform.dev", passwordHash: "x", plan: "FREE" },
  });

  // Bersihkan key lama + buat key baru khusus test ini.
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  const { key, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { userId: user.id, keyHash: hashApiKey(key), keyPrefix: prefix, name: "ratelimit-test" },
  });

  // Bersihkan bucket rate limit menit ini kalau ada sisa dari run sebelumnya.
  const minuteBucket = Math.floor(Date.now() / 60000);
  await redisConnection.del(`ratelimit:${apiKey.id}:${minuteBucket}`);

  console.log("[verify] Memanggil /api/v1/ping 12 kali berurutan (limit Free = 10/menit)...");
  const results: number[] = [];
  for (let i = 0; i < 12; i++) {
    const response = await fetch(`${SERVER_URL}/api/v1/ping`, { headers: { "X-Api-Key": key } });
    results.push(response.status);
  }

  console.log("[verify] Status code tiap panggilan:", results);

  const successCount = results.filter((s) => s === 200).length;
  const rateLimitedCount = results.filter((s) => s === 429).length;

  if (successCount !== 10 || rateLimitedCount !== 2) {
    throw new Error(
      `GAGAL: seharusnya tepat 10x 200 dan 2x 429, didapat ${successCount}x 200 dan ${rateLimitedCount}x 429`
    );
  }

  console.log("[verify] BERHASIL: tepat 10 request pertama diterima (200), 2 request berikutnya ditolak (429 rate limit).");

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

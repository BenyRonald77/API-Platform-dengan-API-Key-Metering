import { redisConnection } from "./redis-connection";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

/**
 * Sliding-ish window sederhana per menit-kalender: key Redis unik per menit
 * berjalan, di-INCR (atomik) lalu di-EXPIRE 60 detik. Karena INCR atomik,
 * banyak request konkuren tetap dihitung dengan benar tanpa race condition.
 */
export async function checkRateLimit(apiKeyId: string, limitPerMinute: number): Promise<RateLimitResult> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `ratelimit:${apiKeyId}:${minuteBucket}`;

  const count = await redisConnection.incr(key);
  if (count === 1) {
    await redisConnection.expire(key, 60);
  }

  return {
    allowed: count <= limitPerMinute,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - count),
  };
}

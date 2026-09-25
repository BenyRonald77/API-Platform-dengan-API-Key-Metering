import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getPlanConfig } from "./plans";

export function currentYearMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface UsageIncrementResult {
  count: number;
  overQuota: boolean;
}

/**
 * Increment atomik: satu statement SQL (INSERT ... ON CONFLICT DO UPDATE),
 * bukan read-then-write terpisah. Karena atomik, setiap request konkuren
 * mendapat nilai `count` baru yang unik dan berurutan - request yang
 * membuat count melewati kuota otomatis bisa dideteksi dengan benar tanpa
 * race condition, tanpa perlu rollback/decrement.
 */
export async function incrementMonthlyUsage(apiKeyId: string, yearMonth: string): Promise<UsageIncrementResult> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "MonthlyUsage" (id, "apiKeyId", "yearMonth", count)
    VALUES (${id}, ${apiKeyId}, ${yearMonth}, 1)
    ON CONFLICT("apiKeyId", "yearMonth") DO UPDATE SET count = "MonthlyUsage".count + 1
    RETURNING count
  `);

  const count = rows[0]?.count ?? 1;
  return { count, overQuota: false };
}

export async function logRequest(apiKeyId: string, path: string, statusCode: number) {
  await prisma.requestLog.create({ data: { apiKeyId, path, statusCode } });
}

export async function getUsageSummary(apiKeyId: string, plan: string, yearMonth = currentYearMonth()) {
  const planConfig = getPlanConfig(plan);
  const usage = await prisma.monthlyUsage.findUnique({
    where: { apiKeyId_yearMonth: { apiKeyId, yearMonth } },
  });
  const count = usage?.count ?? 0;

  return {
    yearMonth,
    count,
    quota: planConfig.monthlyQuota,
    remaining: Math.max(0, planConfig.monthlyQuota - count),
    overageRequests: Math.max(0, count - planConfig.monthlyQuota),
    rateLimitPerMinute: planConfig.rateLimitPerMinute,
  };
}

export async function getDailyUsage(apiKeyId: string, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.$queryRaw<{ day: string; count: bigint }[]>(Prisma.sql`
    SELECT date("createdAt") AS day, COUNT(*) AS count
    FROM "RequestLog"
    WHERE "apiKeyId" = ${apiKeyId} AND "createdAt" >= ${since.toISOString()}
    GROUP BY day
    ORDER BY day ASC
  `);

  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

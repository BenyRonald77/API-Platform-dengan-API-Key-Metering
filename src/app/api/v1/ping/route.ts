import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-key";
import { getPlanConfig } from "@/lib/plans";
import { checkRateLimit } from "@/lib/rate-limiter";
import { incrementMonthlyUsage, logRequest, currentYearMonth } from "@/lib/usage-service";

export const dynamic = "force-dynamic";

/**
 * Endpoint demo publik untuk platform ini. Setiap panggilan diautentikasi
 * lewat header X-Api-Key, diukur rate limit per menit (Redis) dan kuota
 * bulanan (database, atomic increment).
 */
export async function GET(request: NextRequest) {
  const rawKey = request.headers.get("x-api-key");
  if (!rawKey) {
    return NextResponse.json({ error: "Header X-Api-Key wajib diisi" }, { status: 401 });
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    include: { user: true },
  });

  if (!apiKey || apiKey.revokedAt) {
    return NextResponse.json({ error: "API key tidak valid atau sudah dicabut" }, { status: 401 });
  }

  const planConfig = getPlanConfig(apiKey.user.plan);

  const rateLimit = await checkRateLimit(apiKey.id, planConfig.rateLimitPerMinute);
  if (!rateLimit.allowed) {
    await logRequest(apiKey.id, "/api/v1/ping", 429);
    return NextResponse.json(
      { error: "Rate limit terlampaui, coba lagi dalam beberapa detik" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const yearMonth = currentYearMonth();
  const usage = await incrementMonthlyUsage(apiKey.id, yearMonth);
  const overQuota = usage.count > planConfig.monthlyQuota;

  if (overQuota && planConfig.hardCap) {
    await logRequest(apiKey.id, "/api/v1/ping", 429);
    return NextResponse.json(
      { error: "Kuota bulanan paket Free sudah habis. Upgrade ke Pro untuk kuota lebih besar." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-Usage-This-Month": String(usage.count),
        },
      }
    );
  }

  await logRequest(apiKey.id, "/api/v1/ping", 200);

  return NextResponse.json(
    {
      message: "pong",
      plan: apiKey.user.plan,
      usageThisMonth: usage.count,
      monthlyQuota: planConfig.monthlyQuota,
      overQuota,
    },
    {
      headers: {
        "X-RateLimit-Limit": String(rateLimit.limit),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-Usage-This-Month": String(usage.count),
      },
    }
  );
}

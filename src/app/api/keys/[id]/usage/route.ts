import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getUsageSummary, getDailyUsage } from "@/lib/usage-service";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const key = await prisma.apiKey.findUnique({ where: { id: params.id } });
  if (!key || key.userId !== user.id) {
    return NextResponse.json({ error: "API key tidak ditemukan" }, { status: 404 });
  }

  const [summary, daily] = await Promise.all([
    getUsageSummary(key.id, user.plan),
    getDailyUsage(key.id),
  ]);

  return NextResponse.json({ summary, daily });
}

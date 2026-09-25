import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const key = await prisma.apiKey.findUnique({ where: { id: params.id } });
  if (!key || key.userId !== user.id) {
    return NextResponse.json({ error: "API key tidak ditemukan" }, { status: 404 });
  }

  await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

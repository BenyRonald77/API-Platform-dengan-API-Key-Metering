import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PLANS } from "@/lib/plans";

const schema = z.object({ plan: z.enum(PLANS) });

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paket tidak valid" }, { status: 400 });
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { plan: parsed.data.plan } });
  return NextResponse.json({ user: { id: updated.id, plan: updated.plan } });
}

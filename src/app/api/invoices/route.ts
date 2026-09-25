import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { userId: user.id },
    orderBy: { yearMonth: "desc" },
  });

  return NextResponse.json({ invoices });
}

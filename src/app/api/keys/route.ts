import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { generateApiKey, hashApiKey } from "@/lib/api-key";
import { getUsageSummary } from "@/lib/usage-service";

const createSchema = z.object({
  name: z.string().min(1).default("default"),
});

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const withUsage = await Promise.all(
    keys.map(async (k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
      usage: await getUsageSummary(k.id, user.plan),
    }))
  );

  return NextResponse.json({ keys: withUsage, plan: user.plan });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }

  const { key, prefix } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      userId: user.id,
      keyHash: hashApiKey(key),
      keyPrefix: prefix,
      name: parsed.data.name,
    },
  });

  return NextResponse.json(
    { apiKey: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, key } },
    { status: 201 }
  );
}

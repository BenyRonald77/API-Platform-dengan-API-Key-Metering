import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateApiKey, hashApiKey } from "../src/lib/api-key";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const user = await prisma.user.upsert({
    where: { email: "dev@platform.dev" },
    update: {},
    create: { name: "Dev User", email: "dev@platform.dev", passwordHash, plan: "FREE" },
  });

  const existingKey = await prisma.apiKey.findFirst({ where: { userId: user.id } });
  if (!existingKey) {
    const { key, prefix } = generateApiKey();
    await prisma.apiKey.create({
      data: { userId: user.id, keyHash: hashApiKey(key), keyPrefix: prefix, name: "default" },
    });
    console.log("Login: dev@platform.dev / password123");
    console.log("API key (simpan, hanya muncul sekali):", key);
  } else {
    console.log("Login: dev@platform.dev / password123 (API key sudah ada, cek dashboard)");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { prisma } from "./prisma";
import { getPlanConfig } from "./plans";
import { currentYearMonth } from "./usage-service";

export async function generateInvoiceForUser(userId: string, yearMonth = currentYearMonth()) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const planConfig = getPlanConfig(user.plan);

  const apiKeys = await prisma.apiKey.findMany({ where: { userId }, select: { id: true } });
  const apiKeyIds = apiKeys.map((k) => k.id);

  const usages = await prisma.monthlyUsage.findMany({
    where: { apiKeyId: { in: apiKeyIds }, yearMonth },
  });
  const totalRequests = usages.reduce((sum, u) => sum + u.count, 0);

  const overageRequests = planConfig.hardCap ? 0 : Math.max(0, totalRequests - planConfig.monthlyQuota);
  const overageCost = Math.ceil(overageRequests / 1000) * planConfig.overagePricePer1000;
  const totalCost = planConfig.basePrice + overageCost;

  return prisma.invoice.upsert({
    where: { userId_yearMonth: { userId, yearMonth } },
    update: {
      plan: user.plan,
      totalRequests,
      includedRequests: planConfig.monthlyQuota,
      overageRequests,
      baseCost: planConfig.basePrice,
      overageCost,
      totalCost,
    },
    create: {
      userId,
      yearMonth,
      plan: user.plan,
      totalRequests,
      includedRequests: planConfig.monthlyQuota,
      overageRequests,
      baseCost: planConfig.basePrice,
      overageCost,
      totalCost,
    },
  });
}

export async function generateInvoicesForAllUsers(yearMonth = currentYearMonth()) {
  const users = await prisma.user.findMany({ select: { id: true } });
  const invoices = [];
  for (const u of users) {
    invoices.push(await generateInvoiceForUser(u.id, yearMonth));
  }
  return invoices;
}

import "dotenv/config";
import { generateInvoicesForAllUsers } from "../src/lib/billing-service";
import { prisma } from "../src/lib/prisma";

async function main() {
  const yearMonth = process.argv[2];
  const invoices = await generateInvoicesForAllUsers(yearMonth);
  console.log(`[billing] ${invoices.length} invoice digenerate/diperbarui.`);
  invoices.forEach((inv) => {
    console.log(
      `  ${inv.userId} (${inv.plan}) ${inv.yearMonth}: ${inv.totalRequests} request, overage=${inv.overageRequests}, total=Rp${inv.totalCost.toLocaleString("id-ID")}`
    );
  });
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

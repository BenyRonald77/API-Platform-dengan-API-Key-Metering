"use client";

import { useEffect, useState } from "react";

interface Invoice {
  id: string;
  yearMonth: string;
  plan: string;
  totalRequests: number;
  includedRequests: number;
  overageRequests: number;
  baseCost: number;
  overageCost: number;
  totalCost: number;
  generatedAt: string;
}

function formatRp(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data) => setInvoices(data.invoices));
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Riwayat Tagihan</h2>
      <p className="mt-1 text-xs text-slate-500">
        Tagihan digenerate lewat <code>npm run billing:generate</code> (biasanya dijalankan sebagai cron bulanan).
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-4">Periode</th>
              <th className="py-2 pr-4">Paket</th>
              <th className="py-2 pr-4">Total Request</th>
              <th className="py-2 pr-4">Overage</th>
              <th className="py-2 pr-4">Biaya Overage</th>
              <th className="py-2 pr-4">Total Tagihan</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{inv.yearMonth}</td>
                <td className="py-2 pr-4">{inv.plan}</td>
                <td className="py-2 pr-4">{inv.totalRequests}</td>
                <td className="py-2 pr-4">{inv.overageRequests}</td>
                <td className="py-2 pr-4">{formatRp(inv.overageCost)}</td>
                <td className="py-2 pr-4 font-semibold">{formatRp(inv.totalCost)}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Belum ada tagihan yang digenerate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

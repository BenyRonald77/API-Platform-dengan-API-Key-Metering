"use client";

import { useEffect, useState } from "react";

interface Usage {
  yearMonth: string;
  count: number;
  quota: number;
  remaining: number;
  overageRequests: number;
  rateLimitPerMinute: number;
}

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  revokedAt: string | null;
  createdAt: string;
  usage: Usage;
}

interface Me {
  id: string;
  name: string;
  email: string;
  plan: "FREE" | "PRO";
}

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState("default");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tryResult, setTryResult] = useState<Record<string, string>>({});

  async function loadAll() {
    const [meRes, keysRes] = await Promise.all([fetch("/api/auth/me"), fetch("/api/keys")]);
    if (meRes.ok) setMe((await meRes.json()).user);
    if (keysRes.ok) setKeys((await keysRes.json()).keys);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateKey(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await response.json();
      if (response.ok) {
        setRevealedKey(data.apiKey.key);
        setNewKeyName("default");
        loadAll();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await fetch(`/api/keys/${id}/revoke`, { method: "POST" });
    loadAll();
  }

  async function handleSwitchPlan(plan: "FREE" | "PRO") {
    await fetch("/api/user/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    loadAll();
  }

  async function handleTryPing(key: ApiKeyItem, rawKey: string) {
    const response = await fetch("/api/v1/ping", { headers: { "X-Api-Key": rawKey } });
    const data = await response.json();
    setTryResult((prev) => ({ ...prev, [key.id]: `${response.status}: ${JSON.stringify(data)}` }));
    loadAll();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Paket Saat Ini</h2>
        <div className="mt-3 flex gap-3">
          {(["FREE", "PRO"] as const).map((p) => (
            <button
              key={p}
              onClick={() => handleSwitchPlan(p)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                me?.plan === p ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
              }`}
            >
              {p === "FREE" ? "Free (1.000 req/bulan, 10 req/menit)" : "Pro (50.000 req/bulan, 100 req/menit)"}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Buat API Key Baru</h2>
        <form onSubmit={handleCreateKey} className="mt-3 flex gap-3">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creating ? "Membuat..." : "Buat Key"}
          </button>
        </form>
        {revealedKey && (
          <div className="mt-4 rounded-lg bg-slate-900 p-3">
            <p className="text-xs text-slate-400">
              Simpan key ini sekarang - tidak akan ditampilkan lagi setelah halaman di-refresh:
            </p>
            <code className="mt-1 block break-all text-sm text-green-400">{revealedKey}</code>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">API Keys ({keys.length})</h2>
        <div className="mt-4 flex flex-col gap-3">
          {keys.map((k) => (
            <div key={k.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{k.name}</p>
                  <code className="text-xs text-slate-500">{k.keyPrefix}...</code>
                </div>
                {k.revokedAt ? (
                  <span className="text-xs font-semibold text-red-500">DICABUT</span>
                ) : (
                  <button onClick={() => handleRevoke(k.id)} className="text-sm text-red-600 hover:underline">
                    Cabut
                  </button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-400">Penggunaan bulan ini</p>
                  <p className="font-medium">
                    {k.usage.count} / {k.usage.quota}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Sisa kuota</p>
                  <p className="font-medium">{k.usage.remaining}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Overage</p>
                  <p className="font-medium">{k.usage.overageRequests}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Rate limit</p>
                  <p className="font-medium">{k.usage.rateLimitPerMinute}/menit</p>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-brand-500"
                  style={{ width: `${Math.min(100, (k.usage.count / k.usage.quota) * 100)}%` }}
                />
              </div>
              {revealedKey && !k.revokedAt && (
                <button
                  onClick={() => handleTryPing(k, revealedKey)}
                  className="mt-3 text-xs font-medium text-brand-600 hover:underline"
                >
                  Coba panggil /api/v1/ping dengan key ini
                </button>
              )}
              {tryResult[k.id] && <p className="mt-2 break-all text-xs text-slate-500">{tryResult[k.id]}</p>}
            </div>
          ))}
          {keys.length === 0 && <p className="text-sm text-slate-400">Belum ada API key.</p>}
        </div>
      </section>
    </div>
  );
}

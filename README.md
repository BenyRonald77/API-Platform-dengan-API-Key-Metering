# API Platform dengan API Key & Metering

Platform API sederhana: developer mendaftar, mendapat **API key**, setiap
request ke endpoint publik **diukur (metered)** sesuai paket (**Free/Pro**) —
rate limit per menit berbeda, kuota bulanan berbeda — dengan dashboard
penggunaan dan **tagihan bulanan berbasis jumlah request**.

## Arsitektur metering

```
Client  --X-Api-Key: sk_live_...-->  GET /api/v1/ping
                                            │
                                            ├─ 1. Lookup ApiKey by SHA-256 hash (bukan bcrypt - butuh lookup cepat & ter-index)
                                            ├─ 2. Rate limit per menit (Redis INCR + EXPIRE 60s per bucket menit)
                                            ├─ 3. Kuota bulanan (atomic UPSERT increment di database)
                                            └─ 4. Log request (untuk grafik dashboard) + respons
```

### Kenapa SHA-256, bukan bcrypt, untuk API key?

Password dashboard tetap pakai bcrypt (lambat & bersalt, sesuai untuk login
manual sesekali). API key berbeda kebutuhan: **setiap** panggilan API harus
melakukan lookup key→user secepat mungkin lewat index database — bcrypt
tidak bisa di-index untuk pencarian langsung (salt acak per hash). SHA-256
deterministik, sehingga hash-nya bisa dijadikan `UNIQUE` index dan di-lookup
`O(log n)` di setiap request.

### Rate limit per menit (Redis)

```ts
key = `ratelimit:${apiKeyId}:${menitBerjalan}`
INCR key, EXPIRE key 60
allowed = count <= plan.rateLimitPerMinute
```

### Kuota bulanan — atomic upsert increment (inti dari akurasi metering)

```sql
INSERT INTO "MonthlyUsage" (id, "apiKeyId", "yearMonth", count)
VALUES (?, ?, ?, 1)
ON CONFLICT("apiKeyId", "yearMonth") DO UPDATE SET count = count + 1
RETURNING count
```

Satu statement SQL atomik (bukan read-then-write terpisah) — setiap request
konkuren dijamin mendapat nilai `count` yang **unik dan berurutan**, bahkan
di bawah race condition tinggi. Ini yang memungkinkan penegakan kuota (hard
cap Free, overage Pro) akurat tanpa kehilangan hitungan (*lost update*).

- **Free**: begitu `count > kuota` → request ditolak (`429`, hard cap).
- **Pro**: `count` boleh melewati kuota → tetap diproses (soft cap),
  kelebihan dicatat untuk tagihan (*overage billing*).

## Verifikasi (dijalankan terhadap server & database sungguhan)

- **`verify-rate-limit.ts`** — 12 panggilan berurutan ke `/api/v1/ping`
  dengan paket Free (limit 10/menit): hasil aktual **tepat** 10× `200` lalu
  2× `429`.
- **`verify-monthly-quota-concurrency.ts`** — 20 increment **konkuren**
  (`Promise.all`) ke baris `MonthlyUsage` yang sama: hasil aktual 20 nilai
  `count` **unik dan berurutan 1..20**, tanpa duplikat atau lompatan —
  membuktikan atomic increment benar di bawah race condition sungguhan,
  bukan asumsi kode.
- **`verify-free-hardcap.ts`** — usage di-set tepat 1 di bawah kuota Free,
  lalu dua panggilan HTTP sungguhan berurutan: request ke-1000 (`200`),
  request ke-1001 (`429`) — presisi di titik batas, bukan kira-kira.
- **`verify-pro-overage-billing.ts`** — usage Pro di-set 2500 di atas
  kuota, request tetap `200` (soft cap terbukti tidak memblokir), lalu
  invoice di-generate dan **jumlah biaya overage dicocokkan dengan
  perhitungan manual** (2501 request kelebihan → Rp15.000 overage → total
  Rp314.000) — bukan hanya dicek "ada invoice", tapi angkanya diverifikasi.

## Menjalankan secara lokal

```bash
cp .env.example .env
npm install

redis-server --daemonize yes   # Redis wajib untuk rate limiter

npx prisma db push
npm run prisma:seed             # user demo + 1 API key (tampil sekali di terminal)

npm run dev                      # http://localhost:3000
```

Login demo: `dev@platform.dev` / `password123`. Simpan API key yang
ditampilkan `seed` di terminal — tidak bisa dilihat ulang setelah itu
(hanya hash-nya yang disimpan di database).

### Mencoba endpoint publik

```bash
curl http://localhost:3000/api/v1/ping -H "X-Api-Key: sk_live_..."
```

### Generate tagihan bulanan

```bash
npm run billing:generate            # bulan berjalan
npm run billing:generate -- 2026-09  # bulan tertentu
```

Cocok dijalankan sebagai cron bulanan di produksi (mis. tanggal 1 tiap
bulan, untuk periode bulan sebelumnya).

## Struktur proyek

```
src/lib/
  plans.ts               Konfigurasi paket Free/Pro (rate limit, kuota, harga)
  api-key.ts               Generate & hash (SHA-256) API key
  rate-limiter.ts            Rate limit per menit via Redis
  usage-service.ts             Atomic increment kuota bulanan + query dashboard
  billing-service.ts            Hitung & generate invoice dari MonthlyUsage
src/app/
  api/v1/ping/                   Endpoint publik demo (diautentikasi via X-Api-Key)
  api/keys/                       CRUD API key (dashboard, session-authenticated)
  api/invoices/                    Riwayat tagihan
  dashboard/                        UI: kelola key, lihat penggunaan, ganti paket
  dashboard/invoices/                UI: riwayat tagihan
scripts/
  generate-invoices.ts               Runner billing (bisa dijadwalkan cron)
  verify-*.ts                         Skrip verifikasi end-to-end
```

## Di luar cakupan (v1)

- Pembayaran sungguhan (payment gateway) — invoice hanya dihitung & dicatat.
- Multi-key per user dengan scope/permission berbeda per key.
- Rate limit per endpoint (v1: satu rate limit global per API key).

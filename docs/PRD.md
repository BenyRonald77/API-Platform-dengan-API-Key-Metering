# PRD — API Platform dengan API Key & Metering

## 1. Latar Belakang

Developer mendaftar, mendapat API key, lalu memanggil endpoint API platform
ini. Setiap panggilan **diukur (metered)** sesuai paket (Free/Pro) —
dibatasi laju per menit (*rate limit*) dan kuota bulanan — dengan dashboard
penggunaan dan tagihan bulanan berbasis jumlah request.

## 2. Tujuan

1. User mendaftar dan mendapat **API key** yang bisa dipakai untuk
   memanggil endpoint publik platform (`/api/v1/*`).
2. Setiap request **diukur per API key**: rate limit per menit dan kuota
   bulanan berbeda tergantung paket (**Free** vs **Pro**).
3. **Dashboard penggunaan**: grafik request per hari, sisa kuota bulan
   berjalan, status rate limit.
4. **Tagihan bulanan berbasis jumlah request** — Free dibatasi keras
   (hard cap, request ditolak setelah kuota habis), Pro punya kuota
   termasuk + biaya kelebihan (overage) per 1000 request tambahan.

## 3. Solusi Teknis

### 3.1 API Key

Key dibuat sekali (`sk_live_<random>`), ditampilkan **penuh hanya sekali**
saat pembuatan. Disimpan sebagai **SHA-256 hash** (bukan bcrypt) — dipilih
karena lookup key harus dilakukan pada SETIAP request API publik (butuh
lookup cepat berbasis index, bukan hash lambat dengan salt acak seperti
bcrypt yang tidak bisa di-index untuk pencarian langsung).

### 3.2 Rate limit per menit — Redis sliding window per menit

```
key = ratelimit:<apiKeyId>:<menit-berjalan>
INCR key, EXPIRE key 60
jika hasil > plan.rateLimitPerMinute -> 429 Too Many Requests
```

### 3.3 Kuota bulanan — atomic increment di database

Tabel `MonthlyUsage(apiKeyId, yearMonth, count)` dengan **atomic upsert
increment** (`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`,
satu statement SQL, bukan read-then-write terpisah). Karena INCR ini
atomik, setiap request mendapat nilai `count` unik dan berurutan bahkan di
bawah concurrency tinggi — request yang membuat `count` melewati kuota
paket **Free** otomatis ditolak (dan hanya request² tersebutlah yang
ditolak, tidak lebih tidak kurang), tanpa perlu rollback/decrement.

- **Free**: kuota bulanan habis → request ditolak (`429`, hard cap).
- **Pro**: kuota bulanan boleh terlampaui (soft cap) → tetap diproses,
  kelebihan dicatat sebagai *overage* untuk tagihan.

### 3.4 Tagihan bulanan

Dihitung dari `MonthlyUsage` + paket user pada `Invoice` (di-generate per
akhir periode lewat skrip, bisa dijalankan cron bulanan):

```
totalRequests   = MonthlyUsage.count
overageRequests = max(0, totalRequests - plan.monthlyQuota)   // Pro saja
overageCost     = ceil(overageRequests / 1000) * plan.overagePricePer1000
totalCost       = plan.basePrice + overageCost
```

## 4. Model Data (ringkas)

- `User` — akun, `plan` (FREE/PRO).
- `ApiKey` — `keyHash` (unik, di-index), `keyPrefix` (ditampilkan di UI,
  8 karakter pertama), `userId`, `revokedAt`.
- `MonthlyUsage` — `apiKeyId`, `yearMonth` (`"2026-09"`), `count`.
- `RequestLog` — riwayat per-request (untuk grafik dashboard):
  `apiKeyId`, `path`, `statusCode`, `createdAt`.
- `Invoice` — tagihan bulanan yang sudah di-generate: `userId`,
  `yearMonth`, `totalRequests`, `overageRequests`, `totalCost`.

## 5. Verifikasi yang direncanakan

- `verify-rate-limit.ts` — memanggil endpoint publik melebihi
  `rateLimitPerMinute` paket Free dalam satu menit, memverifikasi request
  ke-(N+1) mengembalikan `429` sementara N request pertama `200`.
- `verify-monthly-quota-concurrency.ts` — mengirim request **konkuren**
  (Promise.all) melebihi kuota bulanan Free, memverifikasi TEPAT sejumlah
  kuota yang berhasil `200` dan sisanya `429` — tidak lebih, tidak kurang
  (membuktikan atomic increment benar di bawah race condition, bukan
  asumsi).
- `verify-pro-overage-billing.ts` — user Pro melebihi kuota termasuk,
  memverifikasi request tetap `200` (tidak diblokir) dan tagihan yang
  di-generate menghitung biaya overage dengan benar.

## 6. Di luar cakupan (v1)

- Pembayaran sungguhan (payment gateway) — invoice hanya dihitung &
  dicatat, tidak ada proses pembayaran nyata.
- Multi-key per user dengan scope/permission berbeda per key.
- Rate limit per endpoint (v1: satu rate limit global per API key).

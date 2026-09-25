import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Platform",
  description: "Platform API dengan API key, rate limit per menit, kuota bulanan, dan tagihan berbasis penggunaan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}

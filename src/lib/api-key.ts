import { randomBytes, createHash } from "crypto";

export function generateApiKey(): { key: string; prefix: string } {
  const key = `sk_live_${randomBytes(24).toString("hex")}`;
  return { key, prefix: key.slice(0, 12) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

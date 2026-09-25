export const PLANS = ["FREE", "PRO"] as const;
export type PlanName = (typeof PLANS)[number];

export interface PlanConfig {
  name: PlanName;
  rateLimitPerMinute: number;
  monthlyQuota: number;
  hardCap: boolean; // true = tolak request setelah kuota habis, false = boleh lewat (overage)
  basePrice: number; // dalam Rupiah
  overagePricePer1000: number; // dalam Rupiah, hanya relevan jika hardCap=false
}

export const PLAN_CONFIG: Record<PlanName, PlanConfig> = {
  FREE: {
    name: "FREE",
    rateLimitPerMinute: 10,
    monthlyQuota: 1000,
    hardCap: true,
    basePrice: 0,
    overagePricePer1000: 0,
  },
  PRO: {
    name: "PRO",
    rateLimitPerMinute: 100,
    monthlyQuota: 50000,
    hardCap: false,
    basePrice: 299000,
    overagePricePer1000: 5000,
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIG[plan as PlanName] ?? PLAN_CONFIG.FREE;
}

import { billingMode } from "./stripe";

export type PlanId = "free" | "pro" | "business";
export type PaidPlanId = Exclude<PlanId, "free">;
export const PAID_PLANS: PaidPlanId[] = ["pro", "business"];

export const SIMULATOR_PRICES: Record<PaidPlanId, string> = {
  pro: "price_sim_pro",
  business: "price_sim_business",
};

// Statuses that keep paid features on. past_due stays entitled while Stripe
// retries the card; when retries run out the subscription becomes unpaid or
// canceled and the org drops to free.
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isPaidPlan(plan: string): plan is PaidPlanId {
  return plan === "pro" || plan === "business";
}

export function priceIdForPlan(plan: PaidPlanId): string | null {
  const configured = plan === "pro" ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_BUSINESS;
  if (configured) return configured;
  return billingMode() === "simulator" ? SIMULATOR_PRICES[plan] : null;
}

export function planForPriceId(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  return PAID_PLANS.find((plan) => priceIdForPlan(plan) === priceId) ?? null;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

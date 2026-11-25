import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * stripe:    real Stripe (test or live keys).
 * simulator: no Stripe key in development. Checkout and the customer portal
 *            are replaced by local pages that send signed events through the
 *            same webhook handler.
 * off:       production without a key. Billing pages say billing isn't set up.
 */
export type BillingMode = "stripe" | "simulator" | "off";

export function billingMode(): BillingMode {
  if (process.env.STRIPE_SECRET_KEY) return "stripe";
  if (process.env.NODE_ENV !== "production" || process.env.BILLING_SIMULATOR === "true") return "simulator";
  return "off";
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(env.stripeSecretKey, {
    appInfo: { name: "Tenantry" },
    maxNetworkRetries: 2,
  });
  return client;
}

export function verifyWebhook(payload: string, signature: string): Promise<Stripe.Event> {
  return Stripe.webhooks.constructEventAsync(payload, signature, env.stripeWebhookSecret);
}

export function signWebhookPayload(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: env.stripeWebhookSecret });
}

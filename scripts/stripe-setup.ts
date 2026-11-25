// One-time setup for Stripe test mode. Creates a product and monthly price
// per paid plan and a customer portal configuration, then writes their ids
// to .env.local. Safe to run again: it finds what it made before by lookup key.
//
//   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "node:fs";
import Stripe from "stripe";
import { HANDLED_EVENTS } from "../src/lib/billing/webhook";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (a test-mode or restricted key) in .env.local first.");
  process.exit(1);
}
if (key.startsWith("sk_live") || key.startsWith("rk_live")) {
  console.error("This script is for test mode. Create live products in the Dashboard instead.");
  process.exit(1);
}

const stripe = new Stripe(key);

// One Product per plan, so Checkout and invoices show the plan's own name.
const PLANS = [
  { id: "pro", name: "Tenantry Pro", amount: 2900, lookupKey: "tenantry_pro_monthly" },
  { id: "business", name: "Tenantry Business", amount: 9900, lookupKey: "tenantry_business_monthly" },
] as const;

async function priceFor(plan: (typeof PLANS)[number]) {
  const existing = await stripe.prices.list({ lookup_keys: [plan.lookupKey], expand: ["data.product"] });
  if (existing.data[0]) return existing.data[0];
  const product = await stripe.products.create({ name: plan.name, metadata: { plan_id: plan.id } });
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: plan.amount,
    recurring: { interval: "month" },
    lookup_key: plan.lookupKey,
  });
}

async function main() {
  const prices = await Promise.all(PLANS.map(priceFor));
  const products = prices.map((p) => (typeof p.product === "string" ? p.product : p.product.id));

  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Manage your Tenantry subscription" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: products.map((product, i) => ({ product, prices: [prices[i].id] })),
      },
    },
  });

  const values: Record<string, string> = {
    STRIPE_PRICE_PRO: prices[0].id,
    STRIPE_PRICE_BUSINESS: prices[1].id,
    STRIPE_PORTAL_CONFIGURATION: portal.id,
  };

  const file = ".env.local";
  let env = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, env);

  console.log("Wrote to .env.local:");
  for (const [k, v] of Object.entries(values)) console.log(`  ${k}=${v}`);
  console.log(`
Next, forward webhooks to your dev server and copy the whsec_... secret it prints
into STRIPE_WEBHOOK_SECRET:

  stripe listen --forward-to localhost:3000/api/stripe/webhook \\
    --events ${HANDLED_EVENTS.join(",")}
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

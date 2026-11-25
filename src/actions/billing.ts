"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { env } from "@/lib/env";
import { ENTITLED_STATUSES, isPaidPlan, priceIdForPlan } from "@/lib/billing/plans";
import { billingMode, getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe groups sessions by this label in the Dashboard; it wants a random letter suffix.
const randomLetters = (n: number) => Array.from(randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join("");

async function billingAdmin(formData: FormData) {
  const ctx = await getOrgContext(String(formData.get("slug")));
  return ctx.role === "admin" ? ctx : null;
}

// One Stripe customer per org. Two admins clicking at once both create a
// customer, but only the first one is stored and used.
async function stripeCustomerFor(ctx: NonNullable<Awaited<ReturnType<typeof billingAdmin>>>) {
  if (ctx.billing?.stripe_customer_id) return ctx.billing.stripe_customer_id;
  const customer = await getStripe().customers.create(
    { name: ctx.org.name, email: ctx.user.email, metadata: { org_id: ctx.org.id } },
    { idempotencyKey: `org-customer-${ctx.org.id}` },
  );
  const { data, error } = await createAdminClient().rpc("set_stripe_customer", {
    p_org_id: ctx.org.id,
    p_customer_id: customer.id,
  });
  if (error) throw error;
  return data;
}

export async function startCheckout(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await billingAdmin(formData);
  if (!ctx) return { error: "Only admins can change the plan." };

  const plan = String(formData.get("plan"));
  if (!isPaidPlan(plan)) return { error: "Pick a paid plan." };

  const mode = billingMode();
  if (mode === "off") return { error: "Billing isn't set up on this deployment." };

  // Already subscribed: plan changes go through the portal so Stripe handles proration.
  const subscribed = ctx.billing?.stripe_subscription_id && ENTITLED_STATUSES.has(ctx.billing.status);
  if (subscribed) return openBillingPortal(null, formData);

  if (mode === "simulator") redirect(`/simulator/checkout?org=${ctx.org.slug}&plan=${plan}`);

  const price = priceIdForPlan(plan);
  if (!price) return { error: `Set STRIPE_PRICE_${plan.toUpperCase()} to sell this plan.` };

  let url: string | null;
  try {
    const customer = await stripeCustomerFor(ctx);
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: ctx.org.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { org_id: ctx.org.id } },
      allow_promotion_codes: true,
      integration_identifier: `tenantry_plan_checkout_${randomLetters(8)}`,
      success_url: `${env.appUrl}/o/${ctx.org.slug}/billing?checkout=success`,
      cancel_url: `${env.appUrl}/o/${ctx.org.slug}/billing`,
    });
    url = session.url;
  } catch (error) {
    console.error("[checkout]", error);
    return { error: "Couldn't start checkout. Try again in a moment." };
  }
  if (!url) return { error: "Couldn't start checkout." };
  redirect(url);
}

export async function openBillingPortal(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await billingAdmin(formData);
  if (!ctx) return { error: "Only admins can manage billing." };

  const mode = billingMode();
  if (mode === "off") return { error: "Billing isn't set up on this deployment." };
  if (mode === "simulator") redirect(`/simulator/portal?org=${ctx.org.slug}`);
  if (!ctx.billing?.stripe_customer_id) return { error: "Subscribe to a plan first." };

  let url: string;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: ctx.billing.stripe_customer_id,
      return_url: `${env.appUrl}/o/${ctx.org.slug}/billing`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION } : {}),
    });
    url = session.url;
  } catch (error) {
    console.error("[portal]", error);
    return { error: "Couldn't open the billing portal. Try again in a moment." };
  }
  redirect(url);
}

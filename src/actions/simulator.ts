"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { isPaidPlan, planForPriceId, type PaidPlanId } from "@/lib/billing/plans";
import {
  DAY,
  deliver,
  simId,
  simulatedEvent,
  simulatedInvoice,
  simulatedSubscription,
  type Delivery,
} from "@/lib/billing/simulator";
import { billingMode } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

const PRICES: Record<PaidPlanId, number> = { pro: 2900, business: 9900 };
const now = () => Math.floor(Date.now() / 1000);

async function simulatorContext(formData: FormData) {
  if (billingMode() !== "simulator") return null;
  const ctx = await getOrgContext(String(formData.get("slug")));
  return ctx.role === "admin" ? ctx : null;
}

function summarize(deliveries: Delivery[]) {
  return deliveries.map((d) => `${d.type}: ${d.outcomes.join(", ")}`).join("\n");
}

export async function simulateCheckout(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await simulatorContext(formData);
  if (!ctx) return { error: "The simulator is only for org admins, and only when Stripe isn't configured." };
  const plan = String(formData.get("plan"));
  if (!isPaidPlan(plan)) return { error: "Unknown plan." };

  // Stripe Checkout never creates a subscription for a declined card, so no events.
  if (formData.get("card") === "decline") {
    return { error: "Your card was declined. Nothing was charged and no subscription was created." };
  }

  const db = createAdminClient();
  const { data: customer } = await db.rpc("set_stripe_customer", { p_org_id: ctx.org.id, p_customer_id: simId("cus") });
  const subscriptionId = simId("sub");
  const sub = simulatedSubscription({
    id: subscriptionId,
    customer: customer!,
    orgId: ctx.org.id,
    plan,
    status: "active",
    periodEnd: now() + 30 * DAY,
  });

  await deliver(simulatedEvent("checkout.session.completed", {
    id: simId("cs"),
    object: "checkout.session",
    customer,
    client_reference_id: ctx.org.id,
    subscription: subscriptionId,
    metadata: {},
  }));
  await deliver(simulatedEvent("customer.subscription.created", sub));
  await deliver(simulatedEvent("invoice.paid", simulatedInvoice({
    customer: customer!, subscriptionId, orgId: ctx.org.id, amount: PRICES[plan], paid: true, attempt: 1,
  })));

  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  redirect(`/o/${ctx.org.slug}/billing?checkout=success`);
}

export async function simulatePortal(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await simulatorContext(formData);
  if (!ctx) return { error: "The simulator is only for org admins, and only when Stripe isn't configured." };

  const { data: billing } = await createAdminClient().from("subscriptions").select("*").eq("org_id", ctx.org.id).single();
  if (!billing?.stripe_subscription_id || !billing.stripe_customer_id || billing.status === "canceled") {
    return { error: "There's no active subscription. Start one from the Billing page." };
  }

  // The price, not plan_id: an unpaid subscription still has its price but is entitled to free.
  const plan: PaidPlanId = planForPriceId(billing.stripe_price_id) ?? "pro";
  const times = formData.get("twice") === "on" ? 2 : 1;
  const base = {
    id: billing.stripe_subscription_id,
    customer: billing.stripe_customer_id,
    orgId: ctx.org.id,
    plan,
    status: billing.status,
    periodEnd: billing.current_period_end ? Math.floor(new Date(billing.current_period_end).getTime() / 1000) : now() + 30 * DAY,
    cancelAtPeriodEnd: billing.cancel_at_period_end,
  };
  const invoice = (paid: boolean, attempt: number) =>
    simulatedInvoice({
      customer: base.customer,
      subscriptionId: base.id,
      orgId: ctx.org.id,
      amount: PRICES[plan],
      paid,
      attempt,
    });
  const updated = (overrides: Partial<typeof base>) =>
    simulatedEvent("customer.subscription.updated", simulatedSubscription({ ...base, ...overrides }));

  const deliveries: Delivery[] = [];
  switch (String(formData.get("op"))) {
    case "switch_pro":
      deliveries.push(await deliver(updated({ plan: "pro", status: "active" }), times));
      break;
    case "switch_business":
      deliveries.push(await deliver(updated({ plan: "business", status: "active" }), times));
      break;
    case "cancel":
      deliveries.push(await deliver(updated({ cancelAtPeriodEnd: true }), times));
      break;
    case "resume":
      deliveries.push(await deliver(updated({ cancelAtPeriodEnd: false }), times));
      break;
    case "payment_failed":
      deliveries.push(await deliver(simulatedEvent("invoice.payment_failed", invoice(false, 1)), times));
      deliveries.push(await deliver(updated({ status: "past_due" }), times));
      break;
    case "payment_recovered":
      deliveries.push(await deliver(simulatedEvent("invoice.paid", invoice(true, 2)), times));
      deliveries.push(await deliver(updated({ status: "active" }), times));
      break;
    case "retries_exhausted":
      deliveries.push(await deliver(updated({ status: "unpaid" }), times));
      break;
    case "period_end":
      deliveries.push(
        await deliver(
          simulatedEvent(
            "customer.subscription.deleted",
            simulatedSubscription({ ...base, status: "canceled", canceledAt: now() }),
          ),
          times,
        ),
      );
      break;
    default:
      return { error: "Unknown action." };
  }

  const { data: after } = await createAdminClient()
    .from("subscriptions")
    .select("status, cancel_at_period_end, plans(name)")
    .eq("org_id", ctx.org.id)
    .single();
  const state = after
    ? `Now: ${after.plans?.name} plan, ${after.status.replace("_", " ")}${after.cancel_at_period_end ? ", cancels at period end" : ""}`
    : "";

  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  revalidatePath("/simulator/portal");
  return { ok: `${summarize(deliveries)}
${state}` };
}

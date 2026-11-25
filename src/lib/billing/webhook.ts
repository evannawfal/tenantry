import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingMode, getStripe, verifyWebhook } from "./stripe";
import { planForPriceId } from "./plans";

export type EventOutcome = "applied" | "duplicate" | "stale" | "ignored";

// Subscribe the Stripe webhook endpoint to these.
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
// Metadata is free text. A malformed org id must not make the event fail
// forever, so anything that isn't a UUID is treated as missing.
const orgIdFrom = (value: string | null | undefined) => (value && UUID.test(value) ? value : null);

export function normalizeSubscription(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  return {
    id: sub.id,
    status: sub.status,
    price_id: priceId,
    plan_id: planForPriceId(priceId),
    current_period_end: iso(sub.cancel_at ?? item?.current_period_end),
    // The portal can cancel at period end or at a set date; both mean "ending".
    cancel_at_period_end: sub.cancel_at_period_end || sub.cancel_at !== null,
    canceled_at: iso(sub.canceled_at),
  };
}

type Options = {
  db?: SupabaseClient<Database>;
  // Real Stripe: re-read the subscription so we store its current state, not
  // the state at the time this (possibly late) event was created.
  fetchSubscription?: (id: string) => Promise<Stripe.Subscription>;
  // Disputes and fraud warnings only carry a charge id; the customer is on the charge.
  fetchCharge?: (id: string) => Promise<Stripe.Charge>;
};

async function customerOfCharge(charge: string | Stripe.Charge, options: Options) {
  if (typeof charge !== "string") return idOf(charge.customer);
  if (!options.fetchCharge) return null;
  return idOf((await options.fetchCharge(charge)).customer);
}

export async function processStripeEvent(event: Stripe.Event, options: Options = {}): Promise<EventOutcome> {
  const db = options.db ?? createAdminClient();
  let orgId: string | null = null;
  let customerId: string | null = null;
  let data: Record<string, Json> = {};

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      orgId = orgIdFrom(session.client_reference_id ?? session.metadata?.org_id);
      customerId = idOf(session.customer);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      let sub = event.data.object;
      if (options.fetchSubscription && event.type !== "customer.subscription.deleted") {
        sub = await options.fetchSubscription(sub.id);
      }
      orgId = orgIdFrom(sub.metadata?.org_id);
      customerId = idOf(sub.customer);
      data = normalizeSubscription(sub);
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      orgId = orgIdFrom(invoice.parent?.subscription_details?.metadata?.org_id);
      customerId = idOf(invoice.customer);
      data = {
        invoice_id: invoice.id ?? null,
        amount_due: invoice.amount_due,
        amount_paid: invoice.amount_paid,
        attempt_count: invoice.attempt_count,
        next_payment_attempt: iso(invoice.next_payment_attempt),
      };
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object;
      customerId = idOf(charge.customer);
      data = { object_id: charge.id, amount: charge.amount_refunded };
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object;
      customerId = await customerOfCharge(dispute.charge, options);
      data = { object_id: dispute.id, amount: dispute.amount, reason: dispute.reason };
      break;
    }
    case "radar.early_fraud_warning.created": {
      const warning = event.data.object;
      customerId = await customerOfCharge(warning.charge, options);
      data = { object_id: warning.id, charge_id: idOf(warning.charge), reason: warning.fraud_type };
      break;
    }
  }

  const { data: outcome, error } = await db.rpc("apply_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created: new Date(event.created * 1000).toISOString(),
    // The generated types mark every RPC argument as required; null is valid for these two.
    p_org_id: orgId as string,
    p_customer_id: customerId as string,
    p_data: data,
  });
  if (error) throw new Error(`apply_stripe_event failed for ${event.id}: ${error.message}`);
  return outcome as EventOutcome;
}

/**
 * The webhook endpoint. 400 for a bad signature (Stripe won't retry those),
 * 500 if processing throws (Stripe retries with backoff for up to three days),
 * 200 otherwise, duplicates included.
 */
export async function handleWebhookRequest(request: Request, options: Options = {}): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe-Signature header" }, { status: 400 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await verifyWebhook(payload, signature);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const live = billingMode() === "stripe";
  const fetchSubscription =
    options.fetchSubscription ?? (live ? (id: string) => getStripe().subscriptions.retrieve(id) : undefined);
  const fetchCharge = options.fetchCharge ?? (live ? (id: string) => getStripe().charges.retrieve(id) : undefined);

  try {
    const outcome = await processStripeEvent(event, { ...options, fetchSubscription, fetchCharge });
    return Response.json({ received: true, outcome });
  } catch (error) {
    console.error("[stripe webhook]", event.id, event.type, error);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}

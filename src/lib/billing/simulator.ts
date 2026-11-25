import { randomBytes } from "node:crypto";
import { signWebhookPayload } from "./stripe";
import { handleWebhookRequest } from "./webhook";
import { SIMULATOR_PRICES, type PaidPlanId } from "./plans";

// The simulator stands in for Stripe when there's no API key. It builds
// Stripe-shaped event payloads, signs them with STRIPE_WEBHOOK_SECRET and
// passes them through the real webhook handler, so signature checks,
// idempotency, ordering and plan changes all run the production code path.

export const simId = (prefix: string) => `${prefix}_sim_${randomBytes(12).toString("hex")}`;
const now = () => Math.floor(Date.now() / 1000);
export const DAY = 24 * 60 * 60;

export type Delivery = { id: string; type: string; outcomes: string[] };

export function simulatedEvent(type: string, object: object, created = now()) {
  return {
    id: simId("evt"),
    object: "event",
    api_version: null,
    created,
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

export function simulatedSubscription(opts: {
  id: string;
  customer: string;
  orgId: string;
  plan: PaidPlanId;
  status: string;
  periodEnd: number;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
}) {
  return {
    id: opts.id,
    object: "subscription",
    customer: opts.customer,
    status: opts.status,
    metadata: { org_id: opts.orgId },
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    cancel_at: null,
    canceled_at: opts.canceledAt ?? null,
    items: {
      object: "list",
      data: [
        {
          id: simId("si"),
          object: "subscription_item",
          price: { id: SIMULATOR_PRICES[opts.plan], object: "price" },
          current_period_start: opts.periodEnd - 30 * DAY,
          current_period_end: opts.periodEnd,
        },
      ],
    },
  };
}

export function simulatedInvoice(opts: {
  customer: string;
  subscriptionId: string;
  orgId: string;
  amount: number;
  paid: boolean;
  attempt: number;
}) {
  return {
    id: simId("in"),
    object: "invoice",
    customer: opts.customer,
    amount_due: opts.amount,
    amount_paid: opts.paid ? opts.amount : 0,
    attempt_count: opts.attempt,
    next_payment_attempt: opts.paid ? null : now() + 3 * DAY,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: opts.subscriptionId, metadata: { org_id: opts.orgId } },
    },
  };
}

/** Signs and delivers an event, `times` times, and reports what the handler said each time. */
export async function deliver(event: ReturnType<typeof simulatedEvent>, times = 1): Promise<Delivery> {
  const payload = JSON.stringify(event);
  const outcomes: string[] = [];
  for (let i = 0; i < times; i++) {
    const request = new Request("http://simulator.local/api/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signWebhookPayload(payload) },
      body: payload,
    });
    const response = await handleWebhookRequest(request);
    const body = (await response.json()) as { outcome?: string; error?: string };
    outcomes.push(body.outcome ?? `HTTP ${response.status}: ${body.error}`);
  }
  return { id: event.id, type: event.type, outcomes };
}

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { handleWebhookRequest, normalizeSubscription } from "@/lib/billing/webhook";
import {
  DAY,
  deliver,
  simId,
  simulatedEvent,
  simulatedInvoice,
  simulatedSubscription,
} from "@/lib/billing/simulator";
import { admin, cleanup, createOrg, createUser } from "./helpers";

afterAll(cleanup);

const now = () => Math.floor(Date.now() / 1000);

let orgId: string;
let customer: string;
let subId: string;
const periodEnd = now() + 30 * DAY;

const sub = (overrides: Partial<Parameters<typeof simulatedSubscription>[0]> = {}) =>
  simulatedSubscription({ id: subId, customer, orgId, plan: "pro", status: "active", periodEnd, ...overrides });

const billing = async () => {
  const { data } = await admin().from("subscriptions").select("*").eq("org_id", orgId).single();
  return data!;
};

const auditActions = async () => {
  const { data } = await admin().from("audit_logs").select("action").eq("org_id", orgId).like("action", "billing.%").order("id");
  return data!.map((r) => r.action);
};

beforeEach(async () => {
  const owner = await createUser("billing");
  orgId = await createOrg(owner, "Billing Co");
  customer = simId("cus");
  subId = simId("sub");
});

describe("signature verification", () => {
  it("rejects a request without a signature", async () => {
    const res = await handleWebhookRequest(new Request("http://x/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const payload = JSON.stringify(simulatedEvent("customer.subscription.created", sub()));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    const res = await handleWebhookRequest(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }),
    );
    expect(res.status).toBe(400);
    expect((await billing()).plan_id).toBe("free");
  });

  it("rejects a payload that was changed after signing", async () => {
    const event = simulatedEvent("customer.subscription.created", sub());
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(event),
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    const tampered = JSON.stringify({ ...event, data: { object: sub({ plan: "business" }) } });
    const res = await handleWebhookRequest(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: tampered, headers: { "stripe-signature": signature } }),
    );
    expect(res.status).toBe(400);
  });
});

describe("idempotency", () => {
  it("applies an event once no matter how many times it's delivered", async () => {
    const result = await deliver(simulatedEvent("customer.subscription.created", sub()), 3);
    expect(result.outcomes).toEqual(["applied", "duplicate", "duplicate"]);
    expect((await billing()).plan_id).toBe("pro");
    expect(await auditActions()).toEqual(["billing.subscription_started"]);
  });

  it("handles the same event arriving concurrently", async () => {
    const event = simulatedEvent("invoice.payment_failed",
      simulatedInvoice({ customer, subscriptionId: subId, orgId, amount: 2900, paid: false, attempt: 1 }));
    await deliver(simulatedEvent("customer.subscription.created", sub(), now() - 5));
    const results = await Promise.all([deliver(event), deliver(event), deliver(event)]);
    const outcomes = results.flatMap((r) => r.outcomes).sort();
    expect(outcomes).toEqual(["applied", "duplicate", "duplicate"]);
    expect((await auditActions()).filter((a) => a === "billing.payment_failed")).toHaveLength(1);
  });
});

describe("ordering", () => {
  it("ignores an older subscription event that arrives after a newer one", async () => {
    const t = now();
    await deliver(simulatedEvent("customer.subscription.updated", sub({ plan: "business" }), t));
    const late = await deliver(simulatedEvent("customer.subscription.created", sub({ plan: "pro" }), t - 60));
    expect(late.outcomes).toEqual(["stale"]);
    expect((await billing()).plan_id).toBe("business");
  });

  it("doesn't let an old subscription's cancellation wipe out a newer one", async () => {
    const t = now();
    const oldSub = simId("sub");
    await deliver(simulatedEvent("customer.subscription.created", sub(), t - 10));
    // Old subscription (from before) reports canceled with a newer timestamp.
    const result = await deliver(
      simulatedEvent("customer.subscription.deleted", sub({ id: oldSub, status: "canceled" }), t),
    );
    expect(result.outcomes).toEqual(["stale"]);
    expect((await billing()).plan_id).toBe("pro");
  });
});

describe("lifecycle", () => {
  it("checkout links the Stripe customer to the org", async () => {
    const session = { id: simId("cs"), object: "checkout.session", customer, client_reference_id: orgId, metadata: {} };
    await deliver(simulatedEvent("checkout.session.completed", session));
    expect((await billing()).stripe_customer_id).toBe(customer);
  });

  it("finds the org from the customer id when metadata is missing", async () => {
    await deliver(simulatedEvent("customer.subscription.created", sub(), now() - 5));
    const invoice = simulatedInvoice({ customer, subscriptionId: subId, orgId, amount: 2900, paid: false, attempt: 1 });
    invoice.parent.subscription_details.metadata = {} as { org_id: string };
    const result = await deliver(simulatedEvent("invoice.payment_failed", invoice));
    expect(result.outcomes).toEqual(["applied"]);
    expect((await billing()).payment_failed_at).not.toBeNull();
  });

  it("failed payment keeps access while past due, then recovery clears the warning", async () => {
    const t = now();
    await deliver(simulatedEvent("customer.subscription.created", sub(), t - 30));
    await deliver(simulatedEvent("invoice.payment_failed",
      simulatedInvoice({ customer, subscriptionId: subId, orgId, amount: 2900, paid: false, attempt: 1 }), t - 20));
    await deliver(simulatedEvent("customer.subscription.updated", sub({ status: "past_due" }), t - 20));

    let state = await billing();
    expect(state.plan_id).toBe("pro");
    expect(state.status).toBe("past_due");
    expect(state.payment_failed_at).not.toBeNull();

    await deliver(simulatedEvent("invoice.paid",
      simulatedInvoice({ customer, subscriptionId: subId, orgId, amount: 2900, paid: true, attempt: 2 }), t - 10));
    await deliver(simulatedEvent("customer.subscription.updated", sub({ status: "active" }), t - 10));

    state = await billing();
    expect(state.status).toBe("active");
    expect(state.payment_failed_at).toBeNull();
    expect(await auditActions()).toEqual([
      "billing.subscription_started",
      "billing.payment_failed",
      "billing.past_due",
      "billing.payment_recovered",
    ]);
  });

  it("drops to Free when retries run out (unpaid)", async () => {
    const t = now();
    await deliver(simulatedEvent("customer.subscription.created", sub(), t - 10));
    await deliver(simulatedEvent("customer.subscription.updated", sub({ status: "unpaid" }), t));
    const state = await billing();
    expect(state.plan_id).toBe("free");
    expect(state.status).toBe("unpaid");
  });

  it("cancel at period end keeps the plan until Stripe deletes the subscription", async () => {
    const t = now();
    await deliver(simulatedEvent("customer.subscription.created", sub(), t - 30));
    await deliver(simulatedEvent("customer.subscription.updated", sub({ cancelAtPeriodEnd: true }), t - 20));
    let state = await billing();
    expect(state.plan_id).toBe("pro");
    expect(state.cancel_at_period_end).toBe(true);

    await deliver(simulatedEvent("customer.subscription.deleted",
      sub({ status: "canceled", cancelAtPeriodEnd: true, canceledAt: t }), t - 10));
    state = await billing();
    expect(state.plan_id).toBe("free");
    expect(state.status).toBe("canceled");
    expect(await auditActions()).toEqual([
      "billing.subscription_started",
      "billing.cancellation_scheduled",
      "billing.subscription_ended",
    ]);
  });

  it("records plan changes", async () => {
    const t = now();
    await deliver(simulatedEvent("customer.subscription.created", sub(), t - 10));
    await deliver(simulatedEvent("customer.subscription.updated", sub({ plan: "business" }), t));
    expect((await billing()).plan_id).toBe("business");
    expect(await auditActions()).toEqual(["billing.subscription_started", "billing.plan_changed"]);
  });

  it("records but ignores events for customers it doesn't know", async () => {
    const stranger = simulatedSubscription({
      id: simId("sub"), customer: simId("cus"), orgId: "not-a-uuid", plan: "pro", status: "active", periodEnd,
    });
    const event = simulatedEvent("customer.subscription.created", stranger);
    const result = await deliver(event);
    expect(result.outcomes).toEqual(["ignored"]);
    const { data } = await admin().from("stripe_events").select("outcome").eq("id", event.id).single();
    expect(data!.outcome).toBe("ignored");
  });

  it("re-reads the subscription from Stripe when a client is available", async () => {
    const event = simulatedEvent("customer.subscription.updated", sub({ status: "incomplete" }));
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const res = await handleWebhookRequest(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }),
      { fetchSubscription: async () => sub({ status: "active", plan: "business" }) as unknown as Stripe.Subscription },
    );
    expect(res.status).toBe(200);
    expect((await billing()).plan_id).toBe("business");
  });
});

describe("risk events", () => {
  it("logs refunds, disputes and fraud warnings for the right org", async () => {
    await deliver(simulatedEvent("customer.subscription.created", sub()));
    const charge = { id: simId("ch"), object: "charge", customer, amount_refunded: 2900 };
    await deliver(simulatedEvent("charge.refunded", charge));

    const dispute = { id: simId("dp"), object: "dispute", charge: { ...charge }, amount: 2900, reason: "fraudulent" };
    await deliver(simulatedEvent("charge.dispute.created", dispute));

    const warning = { id: simId("issfr"), object: "radar.early_fraud_warning", charge: charge.id, fraud_type: "card_never_received" };
    const payload = JSON.stringify(simulatedEvent("radar.early_fraud_warning.created", warning));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    await handleWebhookRequest(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }),
      { fetchCharge: async () => charge as unknown as Stripe.Charge },
    );

    expect(await auditActions()).toEqual([
      "billing.subscription_started",
      "billing.refunded",
      "billing.dispute_opened",
      "billing.fraud_warning",
    ]);
  });
});

describe("mapping events to orgs", () => {
  it("trusts the stored customer over metadata that points elsewhere", async () => {
    await deliver(simulatedEvent("customer.subscription.created", sub(), now() - 5));
    const other = await createUser("other");
    const otherOrg = await createOrg(other, "Other Co");
    const misleading = sub({ orgId: otherOrg, plan: "business" });
    await deliver(simulatedEvent("customer.subscription.updated", misleading));
    expect((await billing()).plan_id).toBe("business");
    const { data } = await admin().from("subscriptions").select("plan_id").eq("org_id", otherOrg).single();
    expect(data!.plan_id).toBe("free");
  });
});

describe("normalizeSubscription", () => {
  it("reads the period end from the subscription item and maps the price to a plan", () => {
    const s = sub({ cancelAtPeriodEnd: true }) as unknown as Stripe.Subscription;
    const n = normalizeSubscription(s);
    expect(n.plan_id).toBe("pro");
    expect(n.cancel_at_period_end).toBe(true);
    expect(n.current_period_end).toBe(new Date(periodEnd * 1000).toISOString());
  });

  it("treats a scheduled cancel_at date as ending", () => {
    const s = { ...sub(), cancel_at: periodEnd - DAY } as unknown as Stripe.Subscription;
    const n = normalizeSubscription(s);
    expect(n.cancel_at_period_end).toBe(true);
    expect(n.current_period_end).toBe(new Date((periodEnd - DAY) * 1000).toISOString());
  });
});

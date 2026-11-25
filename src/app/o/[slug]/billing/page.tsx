import type { Metadata } from "next";
import { openBillingPortal, startCheckout } from "@/actions/billing";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Banner, PageHeader, Panel, UsageMeter } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { describeAudit } from "@/lib/audit";
import { ENTITLED_STATUSES, formatPrice } from "@/lib/billing/plans";
import { billingMode } from "@/lib/billing/stripe";
import { formatDate, formatDateTime, STATUS_LABELS } from "@/lib/format";
import { getUsage } from "@/lib/usage";

export const metadata: Metadata = { title: "Billing" };

const limitText = (n: number | null, noun: string) => (n === null ? `Unlimited ${noun}` : `${n} ${noun}`);

export default async function BillingPage(props: PageProps<"/o/[slug]/billing">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const ctx = await getOrgContext(slug);
  const isAdmin = ctx.role === "admin";
  const billing = ctx.billing;
  const current = billing?.plans;
  const mode = billingMode();

  const [usage, { data: plans }, { data: history }] = await Promise.all([
    getUsage(ctx.org.id),
    ctx.supabase.from("plans").select("*").order("sort"),
    isAdmin
      ? ctx.supabase
          .from("audit_logs")
          .select("id, action, metadata, created_at")
          .eq("org_id", ctx.org.id)
          .like("action", "billing.%")
          .order("id", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: null }),
  ]);

  const subscribed = Boolean(billing?.stripe_subscription_id && ENTITLED_STATUSES.has(billing.status));

  return (
    <>
      <PageHeader
        title="Billing"
        description={isAdmin ? "Plan, payment method and invoices." : "Only admins can change the plan."}
        actions={
          isAdmin && billing?.stripe_customer_id && mode !== "off" ? (
            <ActionForm action={openBillingPortal}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton variant="secondary">Manage payment and invoices</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      {search.checkout === "success" ? (
        <div className="mb-6">
          <Banner tone="success" title="Thanks, your subscription is active">
            {subscribed
              ? `You're on ${current?.name}. The new limits apply now.`
              : "Stripe is confirming the payment. This page updates once the webhook arrives, usually within a few seconds."}
          </Banner>
        </div>
      ) : null}
      {mode === "simulator" ? (
        <div className="mb-6">
          <Banner tone="info" title="Stripe simulator">
            No Stripe key is set, so Checkout and the customer portal are local stand-ins. They send signed events
            through the real webhook handler. Add STRIPE_SECRET_KEY to use Stripe test mode instead.
          </Banner>
        </div>
      ) : null}
      {mode === "off" ? (
        <div className="mb-6">
          <Banner tone="warning" title="Billing isn't set up on this deployment">
            Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the price ids to sell plans.
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Current plan">
          <p className="text-[28px] leading-8 font-medium">{current?.name ?? "Free"}</p>
          <p className="mt-1 text-[13px] text-ink-2">
            {STATUS_LABELS[billing?.status ?? "none"] ?? billing?.status}
            {billing?.current_period_end && billing.plan_id !== "free"
              ? `, ${billing.cancel_at_period_end ? "ends" : "renews"} ${formatDate(billing.current_period_end)}`
              : null}
          </p>
          <div className="mt-6 space-y-5">
            <UsageMeter label="Projects" used={usage.projects} limit={current?.max_projects ?? null} />
            <UsageMeter label="Members" used={usage.members} limit={current?.max_members ?? null} />
          </div>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-3">
          {plans?.map((p) => {
            const isCurrent = p.id === (current?.id ?? "free");
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-xl border bg-card p-5 ${isCurrent ? "border-accent/40 shadow-[0_0_0_1px_var(--color-accent)]" : "border-line"}`}
              >
                <p className="font-medium">{p.name}</p>
                <p className="mt-2">
                  <span className="text-2xl font-medium tabular">{formatPrice(p.monthly_price_cents)}</span>
                  <span className="text-[13px] text-ink-3"> / month</span>
                </p>
                <ul className="mt-4 space-y-1 text-[13px] text-ink-2">
                  <li>{limitText(p.max_projects, "projects")}</li>
                  <li>{limitText(p.max_members, "members")}</li>
                </ul>
                <div className="mt-auto pt-5">
                  {isCurrent ? (
                    <p className="text-[13px] font-medium text-accent">Current plan</p>
                  ) : !isAdmin || mode === "off" ? null : p.id === "free" ? (
                    subscribed ? (
                      <ActionForm action={openBillingPortal}>
                        <input type="hidden" name="slug" value={slug} />
                        <SubmitButton variant="ghost" size="sm" className="-ml-3">Cancel subscription</SubmitButton>
                      </ActionForm>
                    ) : null
                  ) : (
                    <ActionForm action={startCheckout}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="plan" value={p.id} />
                      <SubmitButton variant={subscribed ? "secondary" : "primary"} size="sm" className="w-full">
                        {subscribed ? `Switch to ${p.name}` : `Upgrade to ${p.name}`}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {history ? (
        <div className="mt-6">
          <Panel title="Billing history" description="From Stripe webhooks, newest first." flush>
            {history.length ? (
              <ul className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <span>{describeAudit(h)}</span>
                    <span className="text-[13px] text-ink-3 tabular">{formatDateTime(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[13px] text-ink-2">Nothing yet. Subscription changes and payments show up here.</p>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { simulatePortal } from "@/actions/simulator";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { formatDate, STATUS_LABELS } from "@/lib/format";

export const metadata: Metadata = { title: "Customer portal (simulator)" };

const groups = [
  {
    title: "Plan",
    ops: [
      { op: "switch_pro", label: "Switch to Pro", events: "customer.subscription.updated" },
      { op: "switch_business", label: "Switch to Business", events: "customer.subscription.updated" },
    ],
  },
  {
    title: "Cancellation",
    ops: [
      { op: "cancel", label: "Cancel at period end", events: "customer.subscription.updated" },
      { op: "resume", label: "Don't cancel", events: "customer.subscription.updated" },
      { op: "period_end", label: "Reach the end of the period", events: "customer.subscription.deleted" },
    ],
  },
  {
    title: "Payments",
    ops: [
      { op: "payment_failed", label: "Renewal payment fails", events: "invoice.payment_failed, then subscription past_due" },
      { op: "payment_recovered", label: "Retry succeeds", events: "invoice.paid, then subscription active" },
      { op: "retries_exhausted", label: "All retries fail", events: "customer.subscription.updated (unpaid)" },
    ],
  },
];

export default async function SimulatedPortal(props: PageProps<"/simulator/portal">) {
  const search = await props.searchParams;
  const slug = String(search.org ?? "");
  const ctx = await getOrgContext(slug);
  if (ctx.role !== "admin") notFound();
  const billing = ctx.billing;
  const hasSubscription = Boolean(billing?.stripe_subscription_id && billing.status !== "canceled");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href={`/o/${slug}/billing`} className="text-[13px] text-ink-2 hover:text-ink">
        Back to {ctx.org.name}
      </Link>
      <h1 className="mt-6 text-2xl font-medium">Customer portal</h1>
      <p className="mt-1 text-ink-2">
        {billing?.plans?.name ?? "Free"}, {(STATUS_LABELS[billing?.status ?? "none"] ?? billing?.status)?.toLowerCase()}
        {billing?.current_period_end && hasSubscription
          ? `, ${billing.cancel_at_period_end ? "ends" : "renews"} ${formatDate(billing.current_period_end)}`
          : ""}
      </p>

      {!hasSubscription ? (
        <p className="mt-8 rounded-lg border border-line bg-card px-4 py-3 text-ink-2">
          No subscription to manage. Pick a plan on the{" "}
          <Link href={`/o/${slug}/billing`} className="text-accent hover:underline">
            Billing page
          </Link>
          .
        </p>
      ) : null}
      {/* Stays mounted when the subscription ends, so the last result stays visible. */}
      <ActionForm
        action={simulatePortal}
        className="mt-8 rounded-xl border border-line bg-card [&>div:last-child]:px-5 [&>div:last-child]:pb-4 [&_p[role=status]]:font-mono [&_p[role=status]]:text-[12px] [&_p[role=status]]:whitespace-pre-line"
      >
        <input type="hidden" name="slug" value={slug} />
        {groups.map((g) => (
          <fieldset key={g.title} className="border-b border-line px-5 py-4">
            <legend className="float-left mb-3 w-full text-[13px] font-medium">{g.title}</legend>
            <div className="clear-both grid gap-2">
              {g.ops.filter((o) => o.op !== `switch_${billing?.plan_id}`).map((o) => (
                <div key={o.op} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-[12px] text-ink-3">{o.events}</span>
                  <SubmitButton name="op" value={o.op} variant="secondary" size="sm" disabled={!hasSubscription}>
                    {o.label}
                  </SubmitButton>
                </div>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="flex items-center gap-2 px-5 py-4 text-[13px]">
          <input type="checkbox" name="twice" className="accent-[var(--color-accent)]" />
          Deliver every event twice, as Stripe sometimes does. The second delivery should come back as duplicate.
        </label>
      </ActionForm>
    </main>
  );
}

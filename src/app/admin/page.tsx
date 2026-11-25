import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { signOut } from "@/actions/auth";
import { Logo, Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { describeAudit } from "@/lib/audit";
import { ENTITLED_STATUSES, formatPrice } from "@/lib/billing/plans";
import { formatDate, formatDateTime, STATUS_LABELS } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "All organizations" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "paying", label: "Paying" },
  { value: "at_risk", label: "Payment problems" },
  { value: "ending", label: "Cancelling" },
] as const;

const OUTCOME_STYLE: Record<string, string> = {
  applied: "text-positive",
  stale: "text-warning",
  ignored: "text-ink-3",
};

export default async function PlatformAdminPage(props: PageProps<"/admin">) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).single();
  // Checked with the user's own session first. Only then use the secret key,
  // which reads across every tenant.
  if (!me?.is_platform_admin) notFound();

  const filter = String((await props.searchParams).filter ?? "");
  const db = createAdminClient();
  const [{ data: orgs }, { data: events }, { data: risk }] = await Promise.all([
    db
      .from("organizations")
      .select("id, name, slug, created_at, subscriptions(plan_id, status, payment_failed_at, cancel_at_period_end, current_period_end, plans(name, monthly_price_cents)), memberships(count), projects(count)")
      .order("created_at", { ascending: false }),
    db.from("stripe_events").select("id, type, outcome, received_at, organizations(name)").order("received_at", { ascending: false }).limit(15),
    db
      .from("audit_logs")
      .select("id, action, metadata, created_at, organizations(name)")
      .in("action", ["billing.dispute_opened", "billing.refunded", "billing.fraud_warning", "billing.payment_failed"])
      .order("id", { ascending: false })
      .limit(8),
  ]);

  const rows = (orgs ?? []).map((o) => {
    const sub = o.subscriptions;
    const paying = Boolean(sub && sub.plan_id !== "free" && ENTITLED_STATUSES.has(sub.status));
    return {
      ...o,
      sub,
      paying,
      atRisk: Boolean(sub && (sub.status === "past_due" || sub.payment_failed_at)),
      ending: Boolean(sub?.cancel_at_period_end && paying),
      members: o.memberships[0]?.count ?? 0,
      projects: o.projects[0]?.count ?? 0,
      mrr: paying ? (sub?.plans?.monthly_price_cents ?? 0) : 0,
    };
  });

  const shown = rows.filter((r) =>
    filter === "paying" ? r.paying : filter === "at_risk" ? r.atRisk : filter === "ending" ? r.ending : true,
  );
  const mrr = rows.reduce((sum, r) => sum + r.mrr, 0);
  const atRiskMrr = rows.filter((r) => r.atRisk).reduce((sum, r) => sum + r.mrr, 0);

  const stats = [
    { label: "Monthly recurring revenue", value: formatPrice(mrr), note: `${rows.filter((r) => r.paying).length} paying of ${rows.length} organizations` },
    { label: "Revenue at risk", value: formatPrice(atRiskMrr), note: `${rows.filter((r) => r.atRisk).length} with a failed payment` },
    { label: "Cancelling", value: String(rows.filter((r) => r.ending).length), note: "Paid plans set to end at period end" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center justify-between border-b border-line bg-card px-6">
        <div className="flex items-center gap-4">
          <Logo href="/o" />
          <span className="text-[13px] text-ink-3">Platform admin</span>
        </div>
        <form action={signOut}>
          <button className="text-[13px] text-ink-2 hover:text-ink">Log out</button>
        </form>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <h1 className="text-2xl leading-8 font-medium">All organizations</h1>
        <p className="mt-1 text-ink-2">Read-only view across every tenant. Plan and status come from Stripe webhooks.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-card p-5">
              <p className="text-[13px] text-ink-2">{s.label}</p>
              <p className="mt-2 text-[28px] leading-8 font-medium tabular">{s.value}</p>
              <p className="mt-1 text-[13px] text-ink-3">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <nav aria-label="Filter" className="mb-3 flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={f.value ? `/admin?filter=${f.value}` : "/admin"}
                  aria-current={filter === f.value ? "page" : undefined}
                  className={`flex h-8 items-center rounded-md px-3 text-[13px] ${
                    filter === f.value ? "bg-card font-medium shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-ink-2 hover:bg-raised hover:text-ink"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            <Panel flush>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left">
                  <thead className="text-[12px] text-ink-3">
                    <tr className="border-b border-line">
                      <th className="h-9 px-5 font-normal">Organization</th>
                      <th className="h-9 px-3 font-normal">Plan</th>
                      <th className="h-9 px-3 font-normal">Status</th>
                      <th className="h-9 px-3 text-right font-normal">Members</th>
                      <th className="h-9 px-3 text-right font-normal">Projects</th>
                      <th className="h-9 px-5 text-right font-normal">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shown.map((r) => (
                      <tr key={r.id} className="hover:bg-page">
                        <td className="px-5 py-2.5">
                          <p className="font-medium">{r.name}</p>
                          <p className="font-mono text-[12px] text-ink-3">/o/{r.slug}</p>
                        </td>
                        <td className="px-3 py-2.5">{r.sub?.plans?.name ?? "Free"}</td>
                        <td className="px-3 py-2.5 text-[13px]">
                          <span className={r.atRisk ? "text-negative" : r.ending ? "text-warning" : "text-ink-2"}>
                            {STATUS_LABELS[r.sub?.status ?? "none"] ?? r.sub?.status}
                            {r.ending && r.sub?.current_period_end ? `, ends ${formatDate(r.sub.current_period_end)}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{r.members}</td>
                        <td className="px-3 py-2.5 text-right tabular">{r.projects}</td>
                        <td className="px-5 py-2.5 text-right text-[13px] text-ink-2 tabular">{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                    {!shown.length ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-ink-2">
                          No organizations match this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Payment and risk events" flush>
              {risk?.length ? (
                <ul className="divide-y divide-line">
                  {risk.map((r) => (
                    <li key={r.id} className="px-5 py-2.5">
                      <p className="text-[13px]">
                        <span className="font-medium">{r.organizations?.name}</span>: {describeAudit(r)}
                      </p>
                      <p className="text-[12px] text-ink-3 tabular">{formatDateTime(r.created_at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-[13px] text-ink-2">No failed payments, refunds or disputes.</p>
              )}
            </Panel>

            <Panel title="Webhook deliveries" description="Latest Stripe events and what the handler did with them." flush>
              <ul className="divide-y divide-line">
                {events?.map((e) => (
                  <li key={e.id} className="px-5 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-[12px]">{e.type}</span>
                      <span className={`shrink-0 font-mono text-[12px] ${OUTCOME_STYLE[e.outcome] ?? "text-ink-2"}`}>{e.outcome}</span>
                    </div>
                    <p className="truncate text-[12px] text-ink-3">
                      {e.organizations?.name ?? "No matching org"}, {formatDateTime(e.received_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </main>
    </div>
  );
}

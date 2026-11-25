import Link from "next/link";
import { EmptyState, PageHeader, Panel, UsageMeter, buttonClass } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { describeAudit } from "@/lib/audit";
import { formatPrice } from "@/lib/billing/plans";
import { formatDate, formatDateTime, STATUS_LABELS } from "@/lib/format";
import { getUsage } from "@/lib/usage";

export default async function OverviewPage(props: PageProps<"/o/[slug]">) {
  const { slug } = await props.params;
  const ctx = await getOrgContext(slug);
  const isAdmin = ctx.role === "admin";
  const plan = ctx.billing?.plans;

  const [usage, { data: projects }, { data: activity }] = await Promise.all([
    getUsage(ctx.org.id),
    ctx.supabase
      .from("projects")
      .select("id, name, updated_at")
      .eq("org_id", ctx.org.id)
      .order("updated_at", { ascending: false })
      .limit(6),
    isAdmin
      ? ctx.supabase
          .from("audit_logs")
          .select("id, action, metadata, actor_email, created_at")
          .eq("org_id", ctx.org.id)
          .order("id", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),
  ]);

  const base = `/o/${slug}`;

  return (
    <>
      <PageHeader title={ctx.org.name} description={`You're ${ctx.role === "admin" ? "an admin" : "a member"} of this organization.`} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Recently updated projects"
          flush
          actions={
            <Link href={`${base}/projects`} className="text-[13px] text-accent hover:underline">
              All projects
            </Link>
          }
        >
          {projects?.length ? (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id} className="flex h-11 items-center justify-between gap-4 px-5">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[13px] text-ink-3 tabular">{formatDate(p.updated_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No projects yet">
              <Link href={`${base}/projects`} className="text-accent hover:underline">
                Create the first one
              </Link>{" "}
              to see it here.
            </EmptyState>
          )}
        </Panel>

        <Panel title={`${plan?.name ?? "Free"} plan`} description={plan?.monthly_price_cents ? `${formatPrice(plan.monthly_price_cents)} per month` : "No card on file"}>
          <div className="space-y-5">
            <UsageMeter label="Projects" used={usage.projects} limit={plan?.max_projects ?? null} />
            <UsageMeter label="Members" used={usage.members} limit={plan?.max_members ?? null} />
          </div>
          <dl className="mt-6 space-y-2 border-t border-line pt-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-2">Status</dt>
              <dd>{STATUS_LABELS[ctx.billing?.status ?? "none"] ?? ctx.billing?.status}</dd>
            </div>
            {ctx.billing?.current_period_end && ctx.billing.plan_id !== "free" ? (
              <div className="flex justify-between">
                <dt className="text-ink-2">{ctx.billing.cancel_at_period_end ? "Ends" : "Renews"}</dt>
                <dd className="tabular">{formatDate(ctx.billing.current_period_end)}</dd>
              </div>
            ) : null}
          </dl>
          <Link href={`${base}/billing`} className={`${buttonClass("secondary", "sm")} mt-5 w-full`}>
            {isAdmin ? "Manage billing" : "View billing"}
          </Link>
        </Panel>
      </div>

      {activity ? (
        <div className="mt-6">
          <Panel
            title="Recent activity"
            flush
            actions={
              <Link href={`${base}/audit`} className="text-[13px] text-accent hover:underline">
                Audit log
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                  <span className="min-w-0">
                    <span className="text-ink">{describeAudit(a)}</span>
                    {a.actor_email && (a.metadata as { email?: string })?.email === a.actor_email ? null : (
                      <span className="text-ink-3"> by {a.actor_email ?? "Stripe"}</span>
                    )}
                  </span>
                  <span className="text-[13px] text-ink-3 tabular">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
    </>
  );
}

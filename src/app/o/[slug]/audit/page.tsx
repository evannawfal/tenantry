import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, buttonClass } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { AUDIT_FILTERS, describeAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditPage(props: PageProps<"/o/[slug]/audit">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const ctx = await getOrgContext(slug);

  if (ctx.role !== "admin") {
    return (
      <>
        <PageHeader title="Audit log" />
        <Panel>
          <EmptyState title="Only admins can see the audit log" />
        </Panel>
      </>
    );
  }

  const type = typeof search.type === "string" && AUDIT_FILTERS.some((f) => f.value === search.type) ? search.type : "";
  const before = typeof search.before === "string" && /^\d+$/.test(search.before) ? Number(search.before) : null;

  let query = ctx.supabase
    .from("audit_logs")
    .select("id, action, metadata, actor_email, created_at")
    .eq("org_id", ctx.org.id)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (type) query = query.like("action", `${type}.%`);
  if (before) query = query.lt("id", before);
  const { data } = await query;

  const rows = (data ?? []).slice(0, PAGE_SIZE);
  const hasMore = (data?.length ?? 0) > PAGE_SIZE;
  const href = (params: Record<string, string | number | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
    const s = q.toString();
    return `/o/${slug}/audit${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Written by database triggers and the Stripe webhook, so every change is recorded no matter which code path made it. Entries can't be edited."
      />

      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-1">
        {AUDIT_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={href({ type: f.value })}
            aria-current={type === f.value ? "page" : undefined}
            className={`flex h-8 items-center rounded-md px-3 text-[13px] ${
              type === f.value ? "bg-card font-medium shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-ink-2 hover:bg-raised hover:text-ink"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <Panel flush>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="sticky top-0 bg-card text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="h-9 px-5 font-normal">Time (UTC)</th>
                  <th className="h-9 px-3 font-normal">Who</th>
                  <th className="h-9 px-3 font-normal">What happened</th>
                  <th className="h-9 px-5 font-normal">Event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-page">
                    <td className="px-5 py-2.5 text-[13px] whitespace-nowrap text-ink-2 tabular">{formatDateTime(r.created_at).replace(" UTC", "")}</td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 text-[13px]">{r.actor_email ?? <span className="text-ink-3">Stripe</span>}</td>
                    <td className="px-3 py-2.5">{describeAudit(r)}</td>
                    <td className="px-5 py-2.5 font-mono text-[12px] whitespace-nowrap text-ink-3">{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={type ? "Nothing in this category yet" : "No activity yet"} />
        )}
      </Panel>

      {before || hasMore ? (
        <div className="mt-4 flex gap-2">
          {before ? (
            <Link href={href({ type })} className={buttonClass("secondary", "sm")}>
              Newest
            </Link>
          ) : null}
          {hasMore ? (
            <Link href={href({ type, before: rows[rows.length - 1].id })} className={buttonClass("secondary", "sm")}>
              Older
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

import { formatDate, formatDateTime } from "./format";
import { formatPrice } from "./billing/plans";

type Row = { action: string; metadata: unknown; target_id?: string | null };
type Meta = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const money = (v: unknown) => (typeof v === "number" ? formatPrice(v) : "");

// One plain sentence per audit action, for the activity feeds.
export function describeAudit(row: Row): string {
  const m = (row.metadata ?? {}) as Meta;
  switch (row.action) {
    case "organization.created":
      return `Created the organization ${s(m.name)}`;
    case "organization.renamed":
      return `Renamed the organization from ${s(m.from)} to ${s(m.to)}`;
    case "project.created":
      return `Created project ${s(m.name)}`;
    case "project.updated": {
      const changes = (m.changes ?? {}) as Meta;
      const name = changes.name as Meta | undefined;
      if (name) return `Renamed project ${s(name.from)} to ${s(name.to)}`;
      return `Edited the description of ${s(m.name)}`;
    }
    case "project.deleted":
      return `Deleted project ${s(m.name)}`;
    case "member.added":
      return `${s(m.email)} joined as ${s(m.role)}`;
    case "member.role_changed":
      return `Changed ${s(m.email)} from ${s(m.from)} to ${s(m.to)}`;
    case "member.removed":
      return `Removed ${s(m.email)}`;
    case "member.left":
      return `${s(m.email)} left the organization`;
    case "invitation.created":
      return `Invited ${s(m.email)} as ${s(m.role)}`;
    case "invitation.revoked":
      return `Revoked the invitation for ${s(m.email)}`;
    case "billing.subscription_started":
      return `Subscribed to ${cap(s(m.plan))}`;
    case "billing.plan_changed":
      return `Changed plan from ${cap(s(m.from))} to ${cap(s(m.to))}`;
    case "billing.subscription_ended":
      return `${cap(s(m.previous_plan))} subscription ended (${s(m.status).replace("_", " ")}). Moved to Free`;
    case "billing.cancellation_scheduled":
      return `Scheduled cancellation${m.ends_at ? ` for ${formatDate(s(m.ends_at))}` : ""}`;
    case "billing.cancellation_reverted":
      return "Kept the subscription (cancellation undone)";
    case "billing.past_due":
      return "Subscription is past due";
    case "billing.payment_failed":
      return `Payment of ${money(m.amount_due)} failed (attempt ${s(m.attempt_count)}${
        m.next_attempt_at ? `, next retry ${formatDateTime(s(m.next_attempt_at))}` : ""
      })`;
    case "billing.payment_recovered":
      return `Payment of ${money(m.amount_paid)} went through`;
    case "billing.refunded":
      return `Refunded ${money(m.amount_refunded)}`;
    case "billing.dispute_opened":
      return `Dispute opened for ${money(m.amount)} (${s(m.reason).replaceAll("_", " ")})`;
    case "billing.fraud_warning":
      return `Early fraud warning: ${s(m.fraud_type).replaceAll("_", " ")}`;
    default:
      return row.action;
  }
}

export const AUDIT_FILTERS = [
  { value: "", label: "All" },
  { value: "project", label: "Projects" },
  { value: "member", label: "Members" },
  { value: "invitation", label: "Invitations" },
  { value: "billing", label: "Billing" },
  { value: "organization", label: "Organization" },
] as const;

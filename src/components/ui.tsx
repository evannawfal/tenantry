import Link from "next/link";
import type { ReactNode } from "react";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[15px] font-medium text-ink">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="2" y="2" width="14" height="4" rx="1" fill="currentColor" />
        <rect x="2" y="7.5" width="10" height="4" rx="1" fill="var(--color-accent)" />
        <rect x="2" y="13" width="6" height="3" rx="1" fill="currentColor" />
      </svg>
      Tenantry
    </Link>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-card text-ink border border-line-strong hover:bg-raised",
  danger: "bg-card text-negative border border-line-strong hover:bg-negative-soft",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised",
};

export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" = "md") {
  return [
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap",
    "transition-[background-color,color,transform] duration-150 ease-[var(--ease-snap)] active:scale-[0.98]",
    "disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
    variants[variant],
  ].join(" ");
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-card px-3 text-sm text-ink placeholder:text-ink-3 " +
  "focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent/30 focus-visible:outline-offset-0";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  // The hint sits outside <label> so it isn't read as part of the field's name.
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1.5 text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl leading-8 font-medium">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  flush,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-medium">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-ink-2">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const bannerTones = {
  danger: "border-negative/25 bg-negative-soft text-negative",
  warning: "border-warning/25 bg-warning-soft text-warning",
  info: "border-line-strong bg-raised text-ink",
  success: "border-accent/25 bg-accent-soft text-accent",
};

export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: keyof typeof bannerTones;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 ${bannerTones[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-[13px] text-ink-2">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const over = limit !== null && used > limit;
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-2">{label}</span>
        <span className={`font-mono text-[13px] tabular ${over ? "text-negative" : "text-ink"}`}>
          {used}
          <span className="text-ink-3"> / {limit === null ? "unlimited" : limit}</span>
        </span>
      </div>
      {limit === null ? null : (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
        >
          <div
            className={`h-full rounded-full ${over ? "bg-negative" : full ? "bg-warning" : "bg-accent"}`}
            style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-sm text-[13px] text-ink-2">{children}</div> : null}
    </div>
  );
}

export function RoleLabel({ role }: { role: string }) {
  return (
    <span className={`font-mono text-[12px] ${role === "admin" ? "text-accent" : "text-ink-3"}`}>{role}</span>
  );
}

import Link from "next/link";
import { signOut } from "@/actions/auth";
import { openBillingPortal } from "@/actions/billing";
import { ActionForm, NavLink, SubmitButton } from "@/components/forms";
import { Banner, Logo } from "@/components/ui";
import { getMyOrgs, getOrgContext } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getUsage } from "@/lib/usage";

export default async function OrgLayout(props: LayoutProps<"/o/[slug]">) {
  const { slug } = await props.params;
  const ctx = await getOrgContext(slug);
  const [orgs, usage, { data: profile }] = await Promise.all([
    getMyOrgs(),
    getUsage(ctx.org.id),
    ctx.supabase.from("profiles").select("full_name, email, is_platform_admin").eq("id", ctx.user.id).single(),
  ]);

  const base = `/o/${slug}`;
  const isAdmin = ctx.role === "admin";
  const billing = ctx.billing;
  const plan = billing?.plans;

  const paymentProblem = billing && (billing.status === "past_due" || billing.payment_failed_at);
  const ending = billing && billing.cancel_at_period_end && billing.plan_id !== "free" && billing.current_period_end;
  const overProjects = plan?.max_projects != null && usage.projects > plan.max_projects;
  const overMembers = plan?.max_members != null && usage.members > plan.max_members;

  const portalButton = (label: string) =>
    isAdmin ? (
      <ActionForm action={openBillingPortal}>
        <input type="hidden" name="slug" value={slug} />
        <SubmitButton variant="secondary" size="sm">
          {label}
        </SubmitButton>
      </ActionForm>
    ) : null;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b border-line bg-raised/50 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 md:block">
          <Logo href="/o" />
          <details className="group relative md:mt-5">
            <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-line-strong bg-card px-2.5 text-[13px] [&::-webkit-details-marker]:hidden">
              <span className="truncate font-medium">{ctx.org.name}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 text-ink-3">
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-line bg-card p-1 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:left-0">
              {orgs.map((o) => (
                <Link
                  key={o.id}
                  href={`/o/${o.slug}`}
                  className={`flex h-8 items-center justify-between rounded-md px-2.5 text-[13px] hover:bg-raised ${o.slug === slug ? "font-medium" : "text-ink-2"}`}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="font-mono text-[11px] text-ink-3">{o.role}</span>
                </Link>
              ))}
              <div className="my-1 border-t border-line" />
              <Link href="/onboarding" className="flex h-8 items-center rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-raised hover:text-ink">
                Create organization
              </Link>
            </div>
          </details>
        </div>

        <nav aria-label="Organization" className="flex gap-1 overflow-x-auto px-4 pb-3 md:flex-col md:gap-0.5 md:px-3 md:pt-2">
          <NavLink href={base} exact>Overview</NavLink>
          <NavLink href={`${base}/projects`}>Projects</NavLink>
          <NavLink href={`${base}/members`}>Members</NavLink>
          <NavLink href={`${base}/billing`}>Billing</NavLink>
          {isAdmin ? <NavLink href={`${base}/audit`}>Audit log</NavLink> : null}
          <NavLink href={`${base}/settings`}>Settings</NavLink>
          {profile?.is_platform_admin ? (
            <>
              <div className="hidden md:mt-6 md:mb-2 md:block md:px-2.5 md:text-[12px] md:text-ink-3">Platform</div>
              <NavLink href="/admin">All organizations</NavLink>
            </>
          ) : null}
        </nav>

        <div className="mt-auto hidden border-t border-line px-4 py-3 md:block">
          <p className="truncate text-[13px] font-medium">{profile?.full_name || profile?.email}</p>
          <p className="truncate text-[12px] text-ink-3">{profile?.email}</p>
          <form action={signOut} className="mt-2">
            <button className="text-[12px] text-ink-2 hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">
        <div className="mx-auto max-w-5xl">
          {paymentProblem || ending || overProjects || overMembers ? (
            <div className="mb-8 space-y-2">
              {paymentProblem ? (
                <Banner tone="danger" title="The last payment failed" action={portalButton("Update payment method")}>
                  {isAdmin
                    ? `Stripe will retry the card. If every retry fails, ${ctx.org.name} moves to the Free plan.`
                    : "Ask an admin to update the payment method so the plan stays active."}
                </Banner>
              ) : null}
              {ending ? (
                <Banner tone="info" title={`The ${plan?.name} plan ends on ${formatDate(billing.current_period_end!)}`} action={portalButton(`Keep ${plan?.name}`)}>
                  After that the organization moves to Free. Nothing is deleted.
                </Banner>
              ) : null}
              {overProjects || overMembers ? (
                <Banner
                  tone="warning"
                  title={`Over the ${plan?.name} plan's limits`}
                  action={
                    isAdmin ? (
                      <Link href={`${base}/billing`} className="text-[13px] font-medium text-warning underline underline-offset-4">
                        See plans
                      </Link>
                    ) : null
                  }
                >
                  {[
                    overProjects ? `${usage.projects} of ${plan?.max_projects} projects` : null,
                    overMembers ? `${usage.members} of ${plan?.max_members} members` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  . Everything stays readable and editable, but you can&apos;t add more until you upgrade or remove some.
                </Banner>
              ) : null}
            </div>
          ) : null}
          {props.children}
        </div>
      </main>
    </div>
  );
}

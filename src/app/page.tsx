import Link from "next/link";
import { Logo, buttonClass } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { formatPrice } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";

const REPO = "https://github.com/evannawfal/tenantry";

const preview = [
  { time: "09:12", key: "member.added", text: "jonah@northline.io joined as member", who: "Maya Okafor" },
  { time: "09:40", key: "project.created", text: "Created project Carrier rate cards 2027", who: "Jonah Reyes" },
  { time: "11:03", key: "billing.payment_failed", text: "Payment of $29 failed (attempt 1)", who: "Stripe", tone: "text-negative" },
  { time: "11:03", key: "billing.past_due", text: "Subscription is past due", who: "Stripe", tone: "text-negative" },
  { time: "15:26", key: "billing.payment_recovered", text: "Payment of $29 went through", who: "Stripe", tone: "text-positive" },
  { time: "15:30", key: "member.role_changed", text: "Changed priya@northline.io from member to admin", who: "Maya Okafor" },
];

const facts = [
  {
    title: "Tenant isolation in the database",
    body: "Every table has row-level security. The test suite signs in as two companies and tries to read, write and move each other's rows through the real API.",
  },
  {
    title: "Admin and member roles",
    body: "Admins invite people, change roles and manage billing. Members work on projects. An organization can't lose its last admin.",
  },
  {
    title: "Plan limits that can't be raced",
    body: "Seats and projects are checked by Postgres triggers inside the insert's transaction. Eight simultaneous requests for the last slot: one wins.",
  },
  {
    title: "Webhooks that are safe to receive twice",
    body: "Each Stripe event is recorded and applied in one transaction. Redeliveries change nothing, and an older event arriving late is skipped.",
  },
  {
    title: "Failed payments and cancellations",
    body: "A past-due org keeps its plan while Stripe retries the card. A cancelled plan runs to the end of the period, then drops to Free without deleting anything.",
  },
  {
    title: "An audit log nobody can edit",
    body: "Written by triggers and the webhook handler, so no code path can skip it. Append-only, filterable, visible to admins.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const [user, { data: plans }] = await Promise.all([getUser(), supabase.from("plans").select("*").order("sort")]);

  return (
    <div className="min-h-dvh bg-card">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-5 text-[13px]">
          <a href={REPO} className="hidden text-ink-2 hover:text-ink sm:inline">
            Source
          </a>
          {user ? (
            <Link href="/o" className={buttonClass("primary", "sm")}>
              Open app
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-ink-2 hover:text-ink">
                Log in
              </Link>
              <Link href="/signup" className={buttonClass("primary", "sm")}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-12 pb-20 lg:grid-cols-[1fr_1.15fr] lg:pt-20">
          <div>
            <h1 className="max-w-[16ch] text-[40px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[52px]">
              Teams, roles and Stripe billing, enforced by Postgres
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-7 text-ink-2">
              A Next.js and Supabase starter for B2B SaaS. Each company gets its own workspace, row-level security keeps
              their data apart, and the Stripe subscription decides what each plan can do.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={user ? "/o" : "/signup"} className={`${buttonClass("primary")} h-11 px-5`}>
                {user ? "Open app" : "Create an organization"}
              </Link>
              <a href={REPO} className={`${buttonClass("secondary")} h-11 px-5`}>
                Read the code
              </a>
            </div>
          </div>

          <figure className="overflow-hidden rounded-2xl border border-line bg-page shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
            <figcaption className="flex items-center justify-between border-b border-line bg-card px-4 py-3">
              <span className="text-[13px] font-medium">Northline Freight, audit log</span>
              <span className="font-mono text-[11px] text-ink-3">Nov 24, UTC</span>
            </figcaption>
            <ol className="divide-y divide-line">
              {preview.map((row) => (
                <li key={`${row.time}-${row.key}`} className="grid grid-cols-[44px_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[44px_1fr_auto]">
                  <span className="font-mono text-[12px] text-ink-3 tabular">{row.time}</span>
                  <span className="min-w-0">
                    <span className={`block truncate text-[13px] ${row.tone ?? "text-ink"}`}>{row.text}</span>
                    <span className="block font-mono text-[11px] text-ink-3">{row.key}</span>
                  </span>
                  <span className="hidden text-[12px] text-ink-3 sm:block">{row.who}</span>
                </li>
              ))}
            </ol>
          </figure>
        </section>

        <section className="border-t border-line bg-page">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-xl text-[28px] leading-9 font-medium tracking-[-0.01em]">What&apos;s built</h2>
            <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
              {facts.map((f) => (
                <div key={f.title} className="border-t border-line-strong pt-4">
                  <dt className="font-medium">{f.title}</dt>
                  <dd className="mt-1.5 max-w-[52ch] text-ink-2">{f.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">Plans</h2>
          <p className="mt-2 max-w-xl text-ink-2">
            The limits below come from the same table the database triggers read, so this page can&apos;t drift from what&apos;s enforced.
          </p>
          <div className="mt-10 grid max-w-4xl items-start gap-4 md:grid-cols-3">
            {plans?.map((p) => (
              <div key={p.id} className={`rounded-xl border p-6 ${p.id === "pro" ? "border-ink/20 bg-page" : "border-line"}`}>
                <p className="font-medium">{p.name}</p>
                <p className="mt-3">
                  <span className="text-3xl font-medium tabular">{formatPrice(p.monthly_price_cents)}</span>
                  <span className="text-[13px] text-ink-3"> / month</span>
                </p>
                <ul className="mt-5 space-y-1.5 text-[13px] text-ink-2">
                  <li>{p.max_projects === null ? "Unlimited projects" : `${p.max_projects} projects`}</li>
                  <li>{p.max_members === null ? "Unlimited members" : `${p.max_members} members`}</li>
                  <li>Audit log and roles</li>
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[13px] text-ink-3">
          <span>Tenantry. Next.js, Supabase and Stripe. MIT licensed.</span>
          <a href={REPO} className="hover:text-ink">
            github.com/evannawfal/tenantry
          </a>
        </div>
      </footer>
    </div>
  );
}

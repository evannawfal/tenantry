import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { simulateCheckout } from "@/actions/simulator";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { formatPrice, isPaidPlan } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Checkout (simulator)" };

export default async function SimulatedCheckout(props: PageProps<"/simulator/checkout">) {
  const search = await props.searchParams;
  const slug = String(search.org ?? "");
  const planId = String(search.plan ?? "");
  if (!isPaidPlan(planId)) notFound();

  const ctx = await getOrgContext(slug);
  if (ctx.role !== "admin") notFound();
  const { data: plan } = await ctx.supabase.from("plans").select("*").eq("id", planId).single();
  if (!plan) notFound();

  return (
    <main className="mx-auto grid max-w-4xl gap-10 px-6 py-12 md:grid-cols-2">
      <section>
        <Link href={`/o/${slug}/billing`} className="text-[13px] text-ink-2 hover:text-ink">
          Back to {ctx.org.name}
        </Link>
        <p className="mt-8 text-ink-2">Subscribe to {plan.name}</p>
        <p className="mt-1">
          <span className="text-4xl font-medium tabular">{formatPrice(plan.monthly_price_cents)}</span>
          <span className="text-ink-2"> per month</span>
        </p>
        <dl className="mt-8 space-y-2 border-t border-line pt-4 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-2">{plan.name} plan, billed monthly</dt>
            <dd className="tabular">{formatPrice(plan.monthly_price_cents)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-medium">
            <dt>Due today</dt>
            <dd className="tabular">{formatPrice(plan.monthly_price_cents)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-card p-6 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
        <h1 className="font-medium">Pay with card</h1>
        <ActionForm action={simulateCheckout} className="mt-5 space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="plan" value={planId} />
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-medium">Test card</legend>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-3 py-2.5 has-[:checked]:border-accent">
              <input type="radio" name="card" value="ok" defaultChecked className="accent-[var(--color-accent)]" />
              <span className="font-mono text-[13px] tabular">4242 4242 4242 4242</span>
              <span className="ml-auto text-[12px] text-ink-3">Succeeds</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-3 py-2.5 has-[:checked]:border-accent">
              <input type="radio" name="card" value="decline" className="accent-[var(--color-accent)]" />
              <span className="font-mono text-[13px] tabular">4000 0000 0000 0002</span>
              <span className="ml-auto text-[12px] text-ink-3">Declined</span>
            </label>
          </fieldset>
          <SubmitButton className="w-full">Subscribe</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-[12px] text-ink-3">
          On success this sends checkout.session.completed, customer.subscription.created and invoice.paid, the same
          events Stripe sends after a real Checkout.
        </p>
      </section>
    </main>
  );
}

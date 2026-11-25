import type { Metadata } from "next";
import Link from "next/link";
import { createOrganization } from "@/actions/org";
import { signOut } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Logo, inputClass } from "@/components/ui";
import { getMyOrgs, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Create your organization" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const orgs = await getMyOrgs();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Logo href="/o" />
        <form action={signOut}>
          <button className="text-[13px] text-ink-2 hover:text-ink">Log out {user.email}</button>
        </form>
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[420px]">
          <h1 className="text-2xl leading-8 font-medium">Create your organization</h1>
          <p className="mt-1 text-ink-2">
            You&apos;ll be its admin. Invite your team once it&apos;s set up. If a teammate already invited you, open the link from their invitation instead.
          </p>

          <ActionForm action={createOrganization} className="mt-8 space-y-4">
            <Field label="Company name">
              <input name="name" required minLength={2} maxLength={80} placeholder="Northline Freight" className={inputClass} />
            </Field>
            <Field label="URL" hint="Letters, numbers and dashes. Leave empty to use the company name.">
              <div className="flex items-center rounded-lg border border-line-strong bg-card focus-within:border-accent">
                <span className="pl-3 font-mono text-[13px] text-ink-3">/o/</span>
                <input name="slug" pattern="[a-z0-9-]{3,40}" maxLength={40} placeholder="northline" className="h-9 min-w-0 flex-1 bg-transparent px-1 font-mono text-[13px] outline-none" />
              </div>
            </Field>
            <SubmitButton className="w-full">Create organization</SubmitButton>
          </ActionForm>

          {orgs.length ? (
            <p className="mt-8 text-[13px] text-ink-2">
              Or go back to{" "}
              {orgs.map((o, i) => (
                <span key={o.id}>
                  {i > 0 ? ", " : null}
                  <Link href={`/o/${o.slug}`} className="text-accent hover:underline">
                    {o.name}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

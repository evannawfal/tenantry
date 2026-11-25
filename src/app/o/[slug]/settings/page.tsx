import type { Metadata } from "next";
import { leaveOrganization, renameOrganization, updateProfile } from "@/actions/org";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader, Panel, inputClass } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/o/[slug]/settings">) {
  const { slug } = await props.params;
  const ctx = await getOrgContext(slug);
  const { data: profile } = await ctx.supabase.from("profiles").select("full_name, email").eq("id", ctx.user.id).single();
  const isAdmin = ctx.role === "admin";

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Panel title="Organization" description={isAdmin ? undefined : "Only admins can rename the organization."}>
          <ActionForm action={renameOrganization} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="slug" value={slug} />
            <div className="min-w-[240px] flex-1">
              <Field label="Name">
                <input name="name" defaultValue={ctx.org.name} disabled={!isAdmin} required minLength={2} maxLength={80} className={inputClass} />
              </Field>
            </div>
            {isAdmin ? <SubmitButton variant="secondary">Save</SubmitButton> : null}
          </ActionForm>
          <dl className="mt-5 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-2">URL</dt>
            <dd className="font-mono">/o/{ctx.org.slug}</dd>
            <dt className="text-ink-2">Organization ID</dt>
            <dd className="font-mono break-all">{ctx.org.id}</dd>
          </dl>
        </Panel>

        <Panel title="Your profile" description={profile?.email}>
          <ActionForm action={updateProfile} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Field label="Name">
                <input name="full_name" defaultValue={profile?.full_name ?? ""} required maxLength={100} className={inputClass} />
              </Field>
            </div>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel title="Leave organization" description={`You'll lose access to ${ctx.org.name} until someone invites you again.`}>
          <ActionForm action={leaveOrganization}>
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton variant="danger" confirm={`Leave ${ctx.org.name}?`}>
              Leave {ctx.org.name}
            </SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { changeRole, inviteMember, removeMember, revokeInvitation } from "@/actions/members";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader, Panel, RoleLabel, inputClass } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Members" };

const selectClass = `${inputClass} pr-8`;

export default async function MembersPage(props: PageProps<"/o/[slug]/members">) {
  const { slug } = await props.params;
  const ctx = await getOrgContext(slug);
  const isAdmin = ctx.role === "admin";
  const plan = ctx.billing?.plans;

  const [{ data: members }, { data: invites }] = await Promise.all([
    ctx.supabase
      .from("memberships")
      .select("user_id, role, created_at, profiles!inner(full_name, email)")
      .eq("org_id", ctx.org.id)
      .order("created_at"),
    // RLS returns nothing here for members, so no admin check needed for safety.
    ctx.supabase
      .from("invitations")
      .select("id, email, role, expires_at, created_at, inviter:profiles!invitations_invited_by_fkey(full_name, email)")
      .eq("org_id", ctx.org.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);

  const seatsUsed = (members?.length ?? 0) + (invites?.length ?? 0);
  const limit = plan?.max_members ?? null;

  return (
    <>
      <PageHeader
        title="Members"
        description={
          limit === null
            ? "Your plan has no seat limit."
            : `${seatsUsed} of ${limit} seats used on the ${plan?.name} plan, counting open invitations.`
        }
      />

      {isAdmin ? (
        <Panel title="Invite someone" description="They'll join with the role you pick. Links work once and expire after 7 days.">
          <ActionForm action={inviteMember} resetOnSuccess className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="slug" value={slug} />
            <div className="min-w-[220px] flex-1">
              <Field label="Email">
                <input name="email" type="email" required placeholder="jonah@northline.io" className={inputClass} />
              </Field>
            </div>
            <div className="w-36">
              <Field label="Role">
                <select name="role" defaultValue="member" className={selectClass}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
            </div>
            <SubmitButton>Send invitation</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      <div className="mt-6">
        <Panel title="People" flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="h-9 px-5 font-normal">Name</th>
                  <th className="h-9 px-3 font-normal">Role</th>
                  <th className="h-9 px-3 font-normal">Joined</th>
                  {isAdmin ? <th className="h-9 px-5 font-normal"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members?.map((m) => {
                  const you = m.user_id === ctx.user.id;
                  return (
                    <tr key={m.user_id} className="hover:bg-page">
                      <td className="px-5 py-2.5">
                        <p className="truncate font-medium">
                          {m.profiles.full_name ?? m.profiles.email}
                          {you ? <span className="font-normal text-ink-3"> (you)</span> : null}
                        </p>
                        <p className="truncate text-[13px] text-ink-3">{m.profiles.email}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {isAdmin ? (
                          <ActionForm action={changeRole} className="flex items-center gap-2">
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <select name="role" defaultValue={m.role} aria-label={`Role for ${m.profiles.email}`} className="h-8 rounded-md border border-line-strong bg-card px-2 text-[13px]">
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <SubmitButton variant="ghost" size="sm">Save</SubmitButton>
                          </ActionForm>
                        ) : (
                          <RoleLabel role={m.role} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-ink-2 tabular">{formatDate(m.created_at)}</td>
                      {isAdmin ? (
                        <td className="px-5 py-2.5 text-right">
                          {you ? null : (
                            <ActionForm action={removeMember}>
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="user_id" value={m.user_id} />
                              <SubmitButton variant="ghost" size="sm" confirm={`Remove ${m.profiles.email} from ${ctx.org.name}? They lose access right away.`}>
                                Remove
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {isAdmin && invites?.length ? (
        <div className="mt-6">
          <Panel title="Open invitations" description="Invite the same email again to send a fresh link." flush>
            <ul className="divide-y divide-line">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate">
                      {i.email} <RoleLabel role={i.role} />
                    </p>
                    <p className="text-[13px] text-ink-3">
                      Invited by {i.inviter?.full_name ?? i.inviter?.email ?? "a former member"}, expires {formatDate(i.expires_at)}
                    </p>
                  </div>
                  <ActionForm action={revokeInvitation}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={i.id} />
                    <SubmitButton variant="ghost" size="sm">Revoke</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
    </>
  );
}

import type { Metadata } from "next";
import { createProject, deleteProject, updateProject } from "@/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Field, PageHeader, Panel, inputClass } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getUsage } from "@/lib/usage";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage(props: PageProps<"/o/[slug]/projects">) {
  const { slug } = await props.params;
  const ctx = await getOrgContext(slug);
  const plan = ctx.billing?.plans;
  const [usage, { data: projects }] = await Promise.all([
    getUsage(ctx.org.id),
    ctx.supabase
      .from("projects")
      .select("id, name, description, created_at, created_by, profiles(full_name, email)")
      .eq("org_id", ctx.org.id)
      .order("created_at", { ascending: false }),
  ]);

  const limit = plan?.max_projects ?? null;
  const atLimit = limit !== null && usage.projects >= limit;

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          limit === null
            ? `${usage.projects} projects. Your plan has no project limit.`
            : `${usage.projects} of ${limit} projects on the ${plan?.name} plan.`
        }
      />

      <Panel title="New project">
        <ActionForm action={createProject} resetOnSuccess className="grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <input type="hidden" name="slug" value={slug} />
          <Field label="Name">
            <input name="name" required maxLength={120} placeholder="Carrier rate cards 2027" className={inputClass} />
          </Field>
          <Field label="Description">
            <input name="description" maxLength={2000} placeholder="Optional" className={inputClass} />
          </Field>
          <SubmitButton>Create project</SubmitButton>
        </ActionForm>
        {atLimit ? (
          <p className="mt-3 text-[13px] text-ink-2">
            {usage.projects > (limit ?? 0) ? "You're over" : "You're at"} the {plan?.name} plan&apos;s limit. Creating another will
            be refused until you upgrade or delete {usage.projects > (limit ?? 0) ? "some" : "one"}.
          </p>
        ) : null}
      </Panel>

      <div className="mt-6">
        <Panel flush>
          {projects?.length ? (
            <ul className="divide-y divide-line">
              {projects.map((p) => {
                const canDelete = ctx.role === "admin" || p.created_by === ctx.user.id;
                return (
                  <li key={p.id} className="px-5 py-3">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="mt-0.5 truncate text-[13px] text-ink-2">{p.description || "No description"}</p>
                        </div>
                        <div className="shrink-0 text-right text-[13px] text-ink-3">
                          <p className="tabular">{formatDate(p.created_at)}</p>
                          <p className="truncate">{p.profiles?.full_name ?? p.profiles?.email ?? "Former member"}</p>
                        </div>
                      </summary>
                      <div className="mt-4 rounded-lg border border-line bg-page p-4">
                        <ActionForm action={updateProject} className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="id" value={p.id} />
                          <Field label="Name">
                            <input name="name" defaultValue={p.name} required maxLength={120} className={inputClass} />
                          </Field>
                          <Field label="Description">
                            <input name="description" defaultValue={p.description} maxLength={2000} className={inputClass} />
                          </Field>
                          <SubmitButton variant="secondary">Save</SubmitButton>
                        </ActionForm>
                        {canDelete ? (
                          <ActionForm action={deleteProject} className="mt-4 border-t border-line pt-4">
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="id" value={p.id} />
                            <SubmitButton variant="danger" size="sm" confirm={`Delete ${p.name}? This can't be undone.`}>
                              Delete project
                            </SubmitButton>
                          </ActionForm>
                        ) : (
                          <p className="mt-4 border-t border-line pt-4 text-[13px] text-ink-3">
                            Only admins or the person who created this project can delete it.
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No projects yet">Projects are visible to everyone in {ctx.org.name} and nobody outside it.</EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}

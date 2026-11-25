"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { describeError } from "@/lib/errors";

const projectInput = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(120),
  description: z.string().trim().max(2000, "Keep the description under 2,000 characters").default(""),
});

// The plan limit is checked by a trigger in the database, inside the same
// transaction as the insert. Checking a count here first would race.
export async function createProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(String(formData.get("slug")));
  const input = projectInput.safeParse({ name: formData.get("name"), description: formData.get("description") ?? "" });
  if (!input.success) return { error: input.error.issues[0].message };

  const { error } = await ctx.supabase
    .from("projects")
    .insert({ org_id: ctx.org.id, created_by: ctx.user.id, ...input.data });
  if (error) return { error: describeError(error) };

  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: `Created ${input.data.name}.` };
}

export async function updateProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(String(formData.get("slug")));
  const input = projectInput.safeParse({ name: formData.get("name"), description: formData.get("description") ?? "" });
  if (!input.success) return { error: input.error.issues[0].message };

  const { data, error } = await ctx.supabase
    .from("projects")
    .update(input.data)
    .eq("id", String(formData.get("id")))
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return { error: describeError(error) };
  if (!data?.length) return { error: "That project doesn't exist anymore." };

  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: "Saved." };
}

export async function deleteProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(String(formData.get("slug")));
  const { data, error } = await ctx.supabase
    .from("projects")
    .delete()
    .eq("id", String(formData.get("id")))
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return { error: describeError(error) };
  // RLS turns a forbidden delete into "0 rows", so check.
  if (!data?.length) return { error: "Only admins or the person who created a project can delete it." };

  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: "Deleted." };
}

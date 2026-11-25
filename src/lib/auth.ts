import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "member";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getMyOrgs = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, organizations!inner(id, name, slug)")
    .eq("user_id", user.id)
    .order("created_at");
  return (data ?? []).map((m) => ({ role: m.role as Role, ...m.organizations }));
});

// Loads the org for a URL slug as the signed-in user. RLS only returns orgs
// the user belongs to, so someone else's slug is a 404, not a leak.
export const getOrgContext = cache(async (slug: string) => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at, memberships!inner(role)")
    .eq("slug", slug)
    .eq("memberships.user_id", user.id)
    .maybeSingle();
  if (!org) notFound();

  const { data: billing } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("org_id", org.id)
    .maybeSingle();

  return {
    user,
    supabase,
    org: { id: org.id, name: org.name, slug: org.slug, createdAt: org.created_at },
    role: org.memberships[0].role as Role,
    billing,
  };
});

export type OrgContext = Awaited<ReturnType<typeof getOrgContext>>;

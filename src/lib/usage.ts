import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getUsage = cache(async (orgId: string) => {
  const supabase = await createClient();
  const [projects, members] = await Promise.all([
    supabase.from("projects").select("*", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return { projects: projects.count ?? 0, members: members.count ?? 0 };
});

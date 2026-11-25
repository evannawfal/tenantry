import { redirect } from "next/navigation";
import { getMyOrgs, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Signed-in landing: your first organization, or onboarding if you have none.
export default async function OrgIndex() {
  const user = await requireUser();
  const orgs = await getMyOrgs();
  if (orgs.length) redirect(`/o/${orgs[0].slug}`);

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).single();
  redirect(profile?.is_platform_admin ? "/admin" : "/onboarding");
}

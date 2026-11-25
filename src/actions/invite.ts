"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitation(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", { p_token: String(formData.get("token")) });
  if (error) return { error: describeError(error) };

  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();
  redirect(org ? `/o/${org.slug}` : "/o");
}

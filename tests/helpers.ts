import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { deliver, simId, simulatedEvent, simulatedSubscription, DAY } from "@/lib/billing/simulator";
import type { PaidPlanId } from "@/lib/billing/plans";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;

export const admin = () =>
  createClient<Database>(url(), process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const anon = () =>
  createClient<Database>(url(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export type TestUser = { id: string; email: string; client: SupabaseClient<Database> };

const created = { users: [] as string[], orgs: [] as string[] };

export const tag = () => randomBytes(4).toString("hex");

export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${tag()}@example.com`;
  const password = "correct-horse-battery";
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error) throw error;
  created.users.push(data.user.id);

  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

export async function createOrg(owner: TestUser, name = "Test Org"): Promise<string> {
  const { data, error } = await owner.client.rpc("create_organization", {
    p_name: name,
    p_slug: `org-${tag()}`,
  });
  if (error) throw error;
  created.orgs.push(data);
  return data;
}

export async function addMember(orgId: string, user: TestUser, role: "admin" | "member" = "member") {
  const { error } = await admin().from("memberships").insert({ org_id: orgId, user_id: user.id, role });
  if (error) throw error;
}

/** Puts an org on a paid plan through the real webhook path. */
export async function subscribe(orgId: string, plan: PaidPlanId) {
  const customer = simId("cus");
  const subscription = simulatedSubscription({
    id: simId("sub"),
    customer,
    orgId,
    plan,
    status: "active",
    periodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
  });
  const result = await deliver(simulatedEvent("customer.subscription.created", subscription));
  if (result.outcomes[0] !== "applied") throw new Error(`subscribe failed: ${result.outcomes[0]}`);
  return { customer, subscription };
}

export async function cleanup() {
  const db = admin();
  if (created.orgs.length) await db.from("organizations").delete().in("id", created.orgs);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  created.orgs = [];
  created.users = [];
}

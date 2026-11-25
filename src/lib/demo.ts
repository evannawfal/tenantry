import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { newInviteToken } from "@/lib/invitations";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { DAY, deliver, simId, simulatedEvent, simulatedInvoice, simulatedSubscription } from "@/lib/billing/simulator";

// The public demo gives every visitor their own company, so nobody shares an
// account and one visitor can't change what the next one sees. Sandboxes are
// deleted after DEMO_TTL_DAYS by the cleanup schedule.

export const DEMO_TTL_DAYS = 3;
export const demoEnabled = () => process.env.DEMO_MODE === "true";

const DEMO_DOMAIN = "example.com"; // reserved for documentation, never receives mail

async function demoUser(tag: string, local: string, name: string, password: string) {
  const email = `${local}-${tag}@${DEMO_DOMAIN}`;
  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, demo: true },
  });
  if (error) throw error;
  const client = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

/** Builds a Pro-plan company with two teammates, six projects and some billing history. */
export async function createDemoSandbox() {
  const tag = randomBytes(4).toString("hex");
  const password = randomBytes(24).toString("base64url");
  const slug = `demo-${tag}`;

  const [you, jonah, priya] = await Promise.all([
    demoUser(tag, "alex", "Alex Rivera", password),
    demoUser(tag, "jonah", "Jonah Reyes", password),
    demoUser(tag, "priya", "Priya Shah", password),
  ]);

  const { data: orgId, error } = await you.client.rpc("create_organization", { p_name: "Northline Freight", p_slug: slug });
  if (error) throw error;

  // Pro subscription through the simulator, so billing history is real webhook output.
  const customer = simId("cus");
  const subscriptionId = simId("sub");
  const periodEnd = Math.floor(Date.now() / 1000) + 18 * DAY;
  let t = Math.floor(Date.now() / 1000) - 120;
  const send = async (type: string, object: object) => {
    t += 5;
    await deliver(simulatedEvent(type, object, t));
  };
  const sub = (status: string) =>
    simulatedSubscription({ id: subscriptionId, customer, orgId, plan: "pro", status, periodEnd });
  const invoice = (paid: boolean, attempt: number) =>
    simulatedInvoice({ customer, subscriptionId, orgId, amount: 2900, paid, attempt });

  await createAdminClient().rpc("set_stripe_customer", { p_org_id: orgId, p_customer_id: customer });
  await send("checkout.session.completed", { id: simId("cs"), object: "checkout.session", customer, client_reference_id: orgId });
  await send("customer.subscription.created", sub("active"));
  await send("invoice.paid", invoice(true, 1));

  for (const teammate of [jonah, priya]) {
    const { token, hash } = newInviteToken();
    await you.client.from("invitations").insert({ org_id: orgId, email: teammate.email, token_hash: hash, invited_by: you.id });
    await teammate.client.rpc("accept_invitation", { p_token: token });
  }
  await you.client.from("memberships").update({ role: "admin" }).eq("org_id", orgId).eq("user_id", priya.id);

  const projects: [typeof you, string, string][] = [
    [you, "Vancouver cross-dock rollout", "Move inbound LTL to the new Annacis Island dock by March."],
    [you, "Carrier rate cards 2027", "Collect and compare rate cards from the 14 contracted carriers."],
    [jonah, "Driver app v3", "Proof-of-delivery photos and offline mode."],
    [jonah, "Port of Tacoma integration", "EDI 214 status messages from the terminal operator."],
    [priya, "Q1 fleet audit", "Inspection records and ELD exports for all 38 tractors."],
    [priya, "Customs broker onboarding", ""],
  ];
  for (const [by, name, description] of projects) {
    await by.client.from("projects").insert({ org_id: orgId, name, description, created_by: by.id });
  }

  await send("invoice.payment_failed", invoice(false, 1));
  await send("customer.subscription.updated", sub("past_due"));
  await send("invoice.paid", invoice(true, 2));
  await send("customer.subscription.updated", sub("active"));

  await you.client
    .from("invitations")
    .insert({ org_id: orgId, email: `dispatch-${tag}@${DEMO_DOMAIN}`, token_hash: newInviteToken().hash, invited_by: you.id });

  return { email: you.email, password, slug };
}

/** Deletes demo sandboxes older than the TTL. Orgs go first: a last admin can't be deleted. */
export async function deleteExpiredDemos(before = new Date(Date.now() - DEMO_TTL_DAYS * DAY * 1000)) {
  const db = createAdminClient();
  const cutoff = before.toISOString();

  const { data: orgs } = await db.from("organizations").delete().like("slug", "demo-%").lt("created_at", cutoff).select("id");

  let users = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.user_metadata?.demo === true && user.created_at < cutoff) {
        const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
        if (!deleteError) users++;
      }
    }
    if (data.users.length < 1000) break;
  }
  return { orgs: orgs?.length ?? 0, users };
}

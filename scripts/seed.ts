// Loads demo data into the local database through the same paths the app
// uses: real sign-ins, RPCs, invitations accepted by the invitee, and billing
// changes sent as signed webhook events. Run with `npm run seed`.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { newInviteToken } from "../src/lib/invitations";
import { deliver, simId, simulatedEvent, simulatedInvoice, simulatedSubscription, DAY } from "../src/lib/billing/simulator";
import type { PaidPlanId } from "../src/lib/billing/plans";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/127\.0\.0\.1|localhost/.test(url) && !process.argv.includes("--force")) {
  console.error(`Refusing to seed ${url}. This script is for the local database (pass --force to override).`);
  process.exit(1);
}
delete process.env.STRIPE_SECRET_KEY;

const PASSWORD = "demo-password";
const admin = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
type Client = SupabaseClient<Database>;

async function user(email: string, name: string, platformAdmin = false) {
  const existing = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing.data) {
    const { error } = await admin.auth.admin.deleteUser(existing.data.id);
    if (error) throw error;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  if (platformAdmin) await admin.from("profiles").update({ is_platform_admin: true }).eq("id", data.user.id);
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}
type User = Awaited<ReturnType<typeof user>>;

async function org(owner: User, name: string, slug: string) {
  await admin.from("organizations").delete().eq("slug", slug);
  const { data, error } = await owner.client.rpc("create_organization", { p_name: name, p_slug: slug });
  if (error) throw error;
  return data;
}

async function join(orgId: string, inviter: User, invitee: User, role: "admin" | "member" = "member") {
  const { token, hash } = newInviteToken();
  const ins = await inviter.client
    .from("invitations")
    .insert({ org_id: orgId, email: invitee.email, role, token_hash: hash, invited_by: inviter.id });
  if (ins.error) throw ins.error;
  const { error } = await invitee.client.rpc("accept_invitation", { p_token: token });
  if (error) throw error;
}

async function invite(orgId: string, inviter: User, email: string) {
  const { error } = await inviter.client
    .from("invitations")
    .insert({ org_id: orgId, email, token_hash: newInviteToken().hash, invited_by: inviter.id });
  if (error) throw error;
}

async function projects(client: Client, orgId: string, by: string, list: [string, string][]) {
  for (const [name, description] of list) {
    const { error } = await client.from("projects").insert({ org_id: orgId, name, description, created_by: by });
    if (error) throw error;
  }
}

// Drives a fake Stripe subscription. Each event is a few seconds newer than
// the last so the ordering check sees them in sequence.
function billing(orgId: string, plan: PaidPlanId) {
  const customer = simId("cus");
  const id = simId("sub");
  const periodEnd = Math.floor(Date.now() / 1000) + 18 * DAY;
  let t = Math.floor(Date.now() / 1000) - 300;
  const amount = plan === "pro" ? 2900 : 9900;
  const send = async (type: string, object: object) => {
    t += 5;
    const result = await deliver(simulatedEvent(type, object, t));
    if (result.outcomes[0] !== "applied") throw new Error(`${type}: ${result.outcomes[0]}`);
  };
  const sub = (o: Partial<Parameters<typeof simulatedSubscription>[0]> = {}) =>
    simulatedSubscription({ id, customer, orgId, plan, status: "active", periodEnd, ...o });
  const invoice = (paid: boolean, attempt: number) =>
    simulatedInvoice({ customer, subscriptionId: id, orgId, amount, paid, attempt });

  return {
    start: async () => {
      await admin.rpc("set_stripe_customer", { p_org_id: orgId, p_customer_id: customer });
      await send("checkout.session.completed", { id: simId("cs"), object: "checkout.session", customer, client_reference_id: orgId });
      await send("customer.subscription.created", sub());
      await send("invoice.paid", invoice(true, 1));
    },
    fail: async () => {
      await send("invoice.payment_failed", invoice(false, 1));
      await send("customer.subscription.updated", sub({ status: "past_due" }));
    },
    recover: async () => {
      await send("invoice.paid", invoice(true, 2));
      await send("customer.subscription.updated", sub({ status: "active" }));
    },
    cancelAtPeriodEnd: () => send("customer.subscription.updated", sub({ cancelAtPeriodEnd: true })),
    end: () => send("customer.subscription.deleted", sub({ status: "canceled", canceledAt: t })),
  };
}

async function main() {
  console.log("Seeding demo data...");
  // Orgs first: a user who is an org's last admin can't be deleted.
  await admin.from("organizations").delete().in("slug", ["northline", "glasshouse", "kestrel", "quarry", "fernwood"]);

  const ops = await user("ops@tenantry.test", "Platform Ops", true);
  void ops;

  // Northline Freight: Pro, healthy, had one failed payment that recovered.
  const maya = await user("maya@northline.test", "Maya Okafor");
  const jonah = await user("jonah@northline.test", "Jonah Reyes");
  const priya = await user("priya@northline.test", "Priya Shah");
  const northline = await org(maya, "Northline Freight", "northline");
  const nb = billing(northline, "pro");
  await nb.start();
  await join(northline, maya, jonah);
  await join(northline, maya, priya);
  await maya.client.from("memberships").update({ role: "admin" }).eq("org_id", northline).eq("user_id", priya.id);
  await projects(maya.client, northline, maya.id, [
    ["Vancouver cross-dock rollout", "Move inbound LTL to the new Annacis Island dock by March."],
    ["Carrier rate cards 2027", "Collect and compare rate cards from the 14 contracted carriers."],
  ]);
  await projects(jonah.client, northline, jonah.id, [
    ["Driver app v3", "Proof-of-delivery photos and offline mode."],
    ["Port of Tacoma integration", "EDI 214 status messages from the terminal operator."],
  ]);
  await projects(priya.client, northline, priya.id, [
    ["Q1 fleet audit", "Inspection records and ELD exports for all 38 tractors."],
    ["Customs broker onboarding", ""],
  ]);
  await nb.fail();
  await nb.recover();
  await invite(northline, maya, "dispatch@northline.test");

  // Glasshouse Bakery: Business, renewal payment failing right now.
  const lena = await user("lena@glasshouse.test", "Lena Marsh");
  const tomas = await user("tomas@glasshouse.test", "Tomas Arce");
  const glasshouse = await org(lena, "Glasshouse Bakery", "glasshouse");
  const gb = billing(glasshouse, "business");
  await gb.start();
  await join(glasshouse, lena, tomas);
  await projects(lena.client, glasshouse, lena.id, [
    ["Wholesale order portal", "Cafes order by 2pm for next-morning delivery."],
    ["Holiday menu 2026", "Stollen, panettone and the cardamom bun box."],
    ["Second location fit-out", "Main Street lease starts February 1."],
  ]);
  await gb.fail();

  // Kestrel Design: Pro, cancelled, still active until the period ends.
  const ana = await user("ana@kestrel.test", "Ana Lindqvist");
  const kestrel = await org(ana, "Kestrel Design", "kestrel");
  const kb = billing(kestrel, "pro");
  await kb.start();
  await projects(ana.client, kestrel, ana.id, [
    ["Alder Bank brand refresh", "Logo, type and the branch signage system."],
    ["Studio website rebuild", ""],
  ]);
  await kb.cancelAtPeriodEnd();

  // Quarry Coffee: was on Pro, subscription ended, now over the Free limits.
  const rui = await user("rui@quarry.test", "Rui Costa");
  const quarry = await org(rui, "Quarry Coffee", "quarry");
  const qb = billing(quarry, "pro");
  await qb.start();
  await projects(rui.client, quarry, rui.id, [
    ["Roastery scheduling", ""],
    ["Green coffee contracts", "Huila and Sidamo lots for spring."],
    ["Wholesale price list", ""],
    ["Barista training videos", ""],
    ["POS migration", "Move both cafes off the old terminals."],
  ]);
  await qb.end();

  // Fernwood Dental: Free, at the project limit, one seat taken by an invite.
  const sam = await user("sam@fernwood.test", "Sam Oduya");
  const fernwood = await org(sam, "Fernwood Dental", "fernwood");
  await projects(sam.client, fernwood, sam.id, [
    ["Patient recall emails", "Six-month cleaning reminders."],
    ["Front desk scheduling", ""],
    ["Hygienist onboarding", "Checklist for the two new hires."],
  ]);
  await invite(fernwood, sam, "frontdesk@fernwood.test");

  console.log(`
Done. Every account uses the password "${PASSWORD}".

  maya@northline.test   admin, Northline Freight (Pro)
  jonah@northline.test  member, Northline Freight
  lena@glasshouse.test  admin, Glasshouse Bakery (Business, payment failing)
  ana@kestrel.test      admin, Kestrel Design (Pro, cancelling)
  rui@quarry.test       admin, Quarry Coffee (ended, over Free limits)
  sam@fernwood.test     admin, Fernwood Dental (Free, at limit)
  ops@tenantry.test     platform admin, sees /admin
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

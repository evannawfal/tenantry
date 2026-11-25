import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashInviteToken, newInviteToken } from "@/lib/invitations";
import { addMember, admin, anon, cleanup, createOrg, createUser, type TestUser } from "./helpers";

// Two companies. Every query runs through PostgREST with a real user JWT,
// exactly like the browser or a server action would.
let alice: TestUser; // admin of Harbor
let mo: TestUser; // member of Harbor
let bea: TestUser; // admin of Quarry
let harbor: string;
let quarry: string;
let quarryProject: string;

beforeAll(async () => {
  [alice, mo, bea] = await Promise.all([createUser("alice"), createUser("mo"), createUser("bea")]);
  harbor = await createOrg(alice, "Harbor Studio");
  quarry = await createOrg(bea, "Quarry Labs");
  await addMember(harbor, mo, "member");

  await alice.client.from("projects").insert({ org_id: harbor, name: "Harbor roadmap", created_by: alice.id });
  const { data } = await bea.client
    .from("projects")
    .insert({ org_id: quarry, name: "Quarry secret plan", created_by: bea.id })
    .select("id")
    .single();
  quarryProject = data!.id;
});

afterAll(cleanup);

describe("reads are scoped to your own organizations", () => {
  it("lists only your orgs", async () => {
    const { data } = await alice.client.from("organizations").select("id");
    expect(data!.map((o) => o.id)).toEqual([harbor]);
  });

  it("returns nothing when you ask for another org's rows by id", async () => {
    const checks = await Promise.all([
      alice.client.from("organizations").select("id").eq("id", quarry),
      alice.client.from("projects").select("id").eq("org_id", quarry),
      alice.client.from("projects").select("id").eq("id", quarryProject),
      alice.client.from("memberships").select("user_id").eq("org_id", quarry),
      alice.client.from("subscriptions").select("org_id").eq("org_id", quarry),
      alice.client.from("audit_logs").select("id").eq("org_id", quarry),
      alice.client.from("invitations").select("id").eq("org_id", quarry),
    ]);
    for (const { data, error } of checks) {
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("hides profiles of people you don't share an org with", async () => {
    const { data } = await alice.client.from("profiles").select("id");
    const ids = data!.map((p) => p.id).sort();
    expect(ids).toEqual([alice.id, mo.id].sort());
  });

  it("gives anonymous visitors nothing", async () => {
    const client = anon();
    for (const table of ["organizations", "projects", "memberships", "audit_logs", "subscriptions"] as const) {
      const { data } = await client.from(table).select("*");
      expect(data ?? []).toEqual([]);
    }
  });

  it("keeps stripe_events away from every signed-in user", async () => {
    const { data } = await alice.client.from("stripe_events").select("*");
    expect(data ?? []).toEqual([]);
  });
});

describe("writes can't cross into another organization", () => {
  it("rejects creating a project in someone else's org", async () => {
    const { error } = await alice.client
      .from("projects")
      .insert({ org_id: quarry, name: "Injected", created_by: alice.id });
    expect(error?.code).toBe("42501");
  });

  it("silently matches zero rows when updating or deleting another org's project", async () => {
    await alice.client.from("projects").update({ name: "Hacked" }).eq("id", quarryProject);
    await alice.client.from("projects").delete().eq("id", quarryProject);
    const { data } = await admin().from("projects").select("name").eq("id", quarryProject).single();
    expect(data!.name).toBe("Quarry secret plan");
  });

  it("can't move a project to another org", async () => {
    const { data: mine } = await alice.client.from("projects").select("id").eq("org_id", harbor).limit(1).single();
    const { error } = await alice.client
      .from("projects")
      .update({ org_id: quarry } as never)
      .eq("id", mine!.id);
    expect(error).not.toBeNull();
  });

  it("can't add yourself to another org", async () => {
    const { error } = await alice.client
      .from("memberships")
      .insert({ org_id: quarry, user_id: alice.id, role: "admin" });
    expect(error).not.toBeNull();
    const { count } = await admin()
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("org_id", quarry)
      .eq("user_id", alice.id);
    expect(count).toBe(0);
  });

  it("can't invite people to another org", async () => {
    const { error } = await alice.client.from("invitations").insert({
      org_id: quarry,
      email: "friend@example.com",
      token_hash: hashInviteToken("x"),
      invited_by: alice.id,
    });
    expect(error?.code).toBe("42501");
  });

  it("can't write billing state or audit rows directly", async () => {
    const sub = await alice.client.from("subscriptions").update({ plan_id: "business" } as never).eq("org_id", harbor);
    expect(sub.error).not.toBeNull();
    const audit = await alice.client
      .from("audit_logs")
      .insert({ org_id: harbor, action: "fake.event" } as never);
    expect(audit.error).not.toBeNull();
    const rpc = await alice.client.rpc("apply_stripe_event" as never, {} as never);
    expect(rpc.error).not.toBeNull();
  });
});

describe("roles inside an organization", () => {
  it("lets members read projects but not the audit log or invitations", async () => {
    const projects = await mo.client.from("projects").select("id").eq("org_id", harbor);
    expect(projects.data!.length).toBeGreaterThan(0);
    const audit = await mo.client.from("audit_logs").select("id").eq("org_id", harbor);
    expect(audit.data).toEqual([]);
    const invites = await mo.client.from("invitations").select("id").eq("org_id", harbor);
    expect(invites.data).toEqual([]);
  });

  it("stops a member from promoting themselves", async () => {
    await mo.client.from("memberships").update({ role: "admin" }).eq("org_id", harbor).eq("user_id", mo.id);
    const { data } = await admin().from("memberships").select("role").eq("org_id", harbor).eq("user_id", mo.id).single();
    expect(data!.role).toBe("member");
  });

  it("stops a member from inviting", async () => {
    const { error } = await mo.client.from("invitations").insert({
      org_id: harbor,
      email: "friend@example.com",
      token_hash: hashInviteToken("y"),
      invited_by: mo.id,
    });
    expect(error?.code).toBe("42501");
  });

  it("stops a member from renaming the org or removing others", async () => {
    await mo.client.from("organizations").update({ name: "Renamed" }).eq("id", harbor);
    await mo.client.from("memberships").delete().eq("org_id", harbor).eq("user_id", alice.id);
    const { data: org } = await admin().from("organizations").select("name").eq("id", harbor).single();
    expect(org!.name).toBe("Harbor Studio");
    const { count } = await admin()
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("org_id", harbor)
      .eq("user_id", alice.id);
    expect(count).toBe(1);
  });

  it("never lets an org lose its last admin", async () => {
    const leave = await alice.client.from("memberships").delete().eq("org_id", harbor).eq("user_id", alice.id);
    expect(leave.error?.message).toContain("last_admin");
    const demote = await alice.client
      .from("memberships")
      .update({ role: "member" })
      .eq("org_id", harbor)
      .eq("user_id", alice.id);
    expect(demote.error?.message).toContain("last_admin");
  });

  it("can't change an org's slug, even as admin", async () => {
    const { error } = await alice.client
      .from("organizations")
      .update({ slug: "stolen" } as never)
      .eq("id", harbor);
    expect(error).not.toBeNull();
  });
});

describe("invitations", () => {
  it("won't invite past the seat limit, and says why", async () => {
    // Harbor is on Free (2 seats) and already has Alice and Mo.
    const { error } = await alice.client.from("invitations").insert({
      org_id: harbor,
      email: "third@example.com",
      token_hash: newInviteToken().hash,
      invited_by: alice.id,
    });
    expect(error?.message).toBe("plan_limit_reached");
    expect(error?.hint).toBe("The free plan allows 2 members.");
  });

  it("doesn't reveal another org's plan limits to outsiders", async () => {
    const full = await createUser("full");
    const fullOrg = await createOrg(full, "Full House");
    await addMember(fullOrg, await createUser("second"));
    const { error } = await alice.client.from("invitations").insert({
      org_id: fullOrg,
      email: "x@example.com",
      token_hash: newInviteToken().hash,
      invited_by: alice.id,
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).not.toContain("plan_limit");
  });

  it("rejects a token sent to a different email", async () => {
    const dana = await createUser("dana");
    const erin = await createUser("erin");
    const org = await createOrg(dana, "Dana Co");
    const { token, hash } = newInviteToken();
    await dana.client
      .from("invitations")
      .insert({ org_id: org, email: "someone-else@example.com", token_hash: hash, invited_by: dana.id });
    const { error } = await erin.client.rpc("accept_invitation", { p_token: token });
    expect(error?.message).toContain("invitation_email_mismatch");
  });

  it("accepts a valid token and refuses to reuse it", async () => {
    const fay = await createUser("fay");
    const gus = await createUser("gus");
    const org = await createOrg(fay, "Fay Co");
    const { token, hash } = newInviteToken();
    await fay.client
      .from("invitations")
      .insert({ org_id: org, email: gus.email, role: "admin", token_hash: hash, invited_by: fay.id });

    const first = await gus.client.rpc("accept_invitation", { p_token: token });
    expect(first.error).toBeNull();
    expect(first.data).toBe(org);
    const { data: membership } = await gus.client.from("memberships").select("role").eq("org_id", org).eq("user_id", gus.id).single();
    expect(membership!.role).toBe("admin");

    const second = await gus.client.rpc("accept_invitation", { p_token: token });
    expect(second.error?.message).toContain("invitation_invalid");
  });

  it("stores only the token hash", async () => {
    const { token, hash } = newInviteToken();
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

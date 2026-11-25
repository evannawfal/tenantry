import { afterAll, describe, expect, it } from "vitest";
import { newInviteToken } from "@/lib/invitations";
import { deliver, simulatedEvent, simulatedSubscription } from "@/lib/billing/simulator";
import { admin, cleanup, createOrg, createUser, subscribe } from "./helpers";

afterAll(cleanup);

const project = (orgId: string, userId: string, name: string) => ({ org_id: orgId, name, created_by: userId });

describe("project limits are enforced by the database", () => {
  it("allows 3 projects on Free and rejects the 4th with a clear error", async () => {
    const owner = await createUser("limits");
    const org = await createOrg(owner);
    for (const name of ["One", "Two", "Three"]) {
      const { error } = await owner.client.from("projects").insert(project(org, owner.id, name));
      expect(error).toBeNull();
    }
    const { error } = await owner.client.from("projects").insert(project(org, owner.id, "Four"));
    expect(error?.message).toBe("plan_limit_reached");
    expect(error?.details).toBe("projects");
    expect(error?.hint).toBe("The free plan allows 3 projects.");
  });

  it("lets exactly 3 of 8 simultaneous inserts through", async () => {
    const owner = await createUser("race");
    const org = await createOrg(owner);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => owner.client.from("projects").insert(project(org, owner.id, `P${i}`))),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(3);
    const { count } = await admin().from("projects").select("*", { count: "exact", head: true }).eq("org_id", org);
    expect(count).toBe(3);
  });

  it("raises the limit after upgrading and keeps data after downgrading", async () => {
    const owner = await createUser("upgrade");
    const org = await createOrg(owner);
    for (const name of ["A", "B", "C"]) await owner.client.from("projects").insert(project(org, owner.id, name));

    const { customer, subscription } = await subscribe(org, "pro");
    const fourth = await owner.client.from("projects").insert(project(org, owner.id, "D"));
    expect(fourth.error).toBeNull();

    // Subscription ends: back to Free with 4 projects. Nothing is deleted,
    // but nothing new can be added until they're under the limit.
    const ended = simulatedSubscription({
      id: subscription.id,
      customer,
      orgId: org,
      plan: "pro",
      status: "canceled",
      periodEnd: subscription.items.data[0].current_period_end,
      canceledAt: Math.floor(Date.now() / 1000),
    });
    const result = await deliver(simulatedEvent("customer.subscription.deleted", ended, Math.floor(Date.now() / 1000) + 1));
    expect(result.outcomes).toEqual(["applied"]);

    const { count } = await owner.client.from("projects").select("*", { count: "exact", head: true }).eq("org_id", org);
    expect(count).toBe(4);
    const fifth = await owner.client.from("projects").insert(project(org, owner.id, "E"));
    expect(fifth.error?.message).toBe("plan_limit_reached");
  });

  it("has no project limit on Business", async () => {
    const owner = await createUser("business");
    const org = await createOrg(owner);
    await subscribe(org, "business");
    const rows = Array.from({ length: 30 }, (_, i) => project(org, owner.id, `Project ${i}`));
    const { error } = await owner.client.from("projects").insert(rows);
    expect(error).toBeNull();
  });
});

describe("seat limits count members and open invitations", () => {
  it("allows one invite on Free (2 seats) and blocks the second", async () => {
    const owner = await createUser("seats");
    const org = await createOrg(owner);
    const invite = (email: string) =>
      owner.client.from("invitations").insert({
        org_id: org,
        email,
        token_hash: newInviteToken().hash,
        invited_by: owner.id,
      });

    expect((await invite("first@example.com")).error).toBeNull();
    const second = await invite("second@example.com");
    expect(second.error?.message).toBe("plan_limit_reached");
    expect(second.error?.details).toBe("members");
  });

  it("frees the seat when an invitation is revoked", async () => {
    const owner = await createUser("revoke");
    const org = await createOrg(owner);
    const { data } = await owner.client
      .from("invitations")
      .insert({ org_id: org, email: "x@example.com", token_hash: newInviteToken().hash, invited_by: owner.id })
      .select("id")
      .single();
    await owner.client.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", data!.id);
    const again = await owner.client
      .from("invitations")
      .insert({ org_id: org, email: "y@example.com", token_hash: newInviteToken().hash, invited_by: owner.id });
    expect(again.error).toBeNull();
  });
});

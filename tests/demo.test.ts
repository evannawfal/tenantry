import { describe, expect, it } from "vitest";
import { createDemoSandbox, deleteExpiredDemos } from "@/lib/demo";
import { admin, cleanup, createUser } from "./helpers";
import { afterAll } from "vitest";

afterAll(cleanup);

describe("public demo sandboxes", () => {
  it("builds a seeded company and cleans it up after it expires", async () => {
    const regular = await createUser("regular");
    const sandbox = await createDemoSandbox();
    const db = admin();
    const { data: org } = await db.from("organizations").select("id").eq("slug", sandbox.slug).single();
    const { data: billing } = await db.from("subscriptions").select("plan_id, status").eq("org_id", org!.id).single();
    expect(billing).toEqual({ plan_id: "pro", status: "active" });
    const { count } = await db.from("projects").select("*", { count: "exact", head: true }).eq("org_id", org!.id);
    expect(count).toBe(6);

    // Not expired yet: untouched.
    await deleteExpiredDemos();
    expect((await db.from("organizations").select("id").eq("slug", sandbox.slug)).data).toHaveLength(1);

    // Pretend the TTL has passed.
    const result = await deleteExpiredDemos(new Date(Date.now() + 60_000));
    expect(result.orgs).toBeGreaterThanOrEqual(1);
    expect(result.users).toBeGreaterThanOrEqual(3);
    expect((await db.from("organizations").select("id").eq("slug", sandbox.slug)).data).toHaveLength(0);
    expect((await db.from("profiles").select("id").eq("email", sandbox.email)).data).toHaveLength(0);
    // Non-demo accounts survive.
    expect((await db.from("profiles").select("id").eq("id", regular.id)).data).toHaveLength(1);
  });
});

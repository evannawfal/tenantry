import { expect, test, type Page } from "@playwright/test";

// One company from signup to cancellation, with a second person invited in.
// Runs against `npm run dev` with the local Supabase stack and the Stripe
// simulator (no STRIPE_SECRET_KEY).

const tag = Math.random().toString(36).slice(2, 8);
const adminEmail = `owner-${tag}@harbor.test`;
const memberEmail = `analyst-${tag}@harbor.test`;
const password = "harbor-password";
const orgName = `Harbor Analytics ${tag}`;
const slug = `harbor-${tag}`;

// Next.js renders its own role="alert" route announcer; skip it.
const alert = (p: Page) => p.getByRole("alert").and(p.locator(":not(#__next-route-announcer__)"));

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function createProject(page: Page, name: string) {
  await page.getByLabel("Name").first().fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
}

test("an organization's full lifecycle", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();

  await test.step("sign up and create the organization", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create account" }).click();
    await signUp(page, "Hana Ito", adminEmail);
    await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible();
    await page.getByLabel("Company name").fill(orgName);
    await page.locator('input[name="slug"]').fill(slug);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    await expect(page.getByRole("heading", { name: orgName })).toBeVisible();
  });

  await test.step("hit the Free plan's project limit", async () => {
    await page.getByRole("link", { name: "Projects" }).first().click();
    for (const name of ["Churn model", "Board deck Q1", "Warehouse migration"]) {
      await createProject(page, name);
      await expect(page.getByText(`Created ${name}.`)).toBeVisible();
    }
    await createProject(page, "One too many");
    await expect(alert(page)).toContainText("The free plan allows 3 projects.");
    // The form keeps what was typed when the server says no.
    await expect(page.getByLabel("Name").first()).toHaveValue("One too many");
  });

  let inviteLink = "";
  await test.step("invite a teammate", async () => {
    await page.getByRole("link", { name: "Members" }).click();
    await page.getByLabel("Email").fill(memberEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    const link = page.getByLabel("Invitation link");
    await expect(link).toBeVisible();
    inviteLink = await link.inputValue();
    expect(inviteLink).toContain("/invite/");
    await expect(page.getByText("2 of 2 seats used")).toBeVisible();
  });

  await test.step("a declined card changes nothing, then upgrade to Pro", async () => {
    await page.getByRole("link", { name: "Billing" }).click();
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await expect(page).toHaveURL(/\/simulator\/checkout/);
    await page.getByLabel(/4000 0000 0000 0002/).check();
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(alert(page)).toContainText("declined");

    await page.getByLabel(/4242 4242 4242 4242/).check();
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/billing\\?checkout=success`));
    await expect(page.getByText("You're on Pro.")).toBeVisible();
    await expect(page.getByText("Subscribed to Pro")).toBeVisible();

    await page.getByRole("link", { name: "Projects" }).first().click();
    await createProject(page, "One too many");
    await expect(page.getByText("Created One too many.")).toBeVisible();
  });

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();

  await test.step("the teammate accepts and sees member permissions", async () => {
    await member.goto(inviteLink);
    await expect(member.getByRole("heading", { name: `Join ${orgName}` })).toBeVisible();
    await member.getByRole("link", { name: "Create account" }).click();
    await signUp(member, "Leo Park", memberEmail);
    await expect(member).toHaveURL(new RegExp(`/invite/`));
    await member.getByRole("button", { name: `Join ${orgName}` }).click();
    await expect(member).toHaveURL(new RegExp(`/o/${slug}$`));
    await expect(member.getByText("You're a member of this organization.")).toBeVisible();
    await expect(member.getByRole("link", { name: "Audit log" })).toHaveCount(0);

    await member.goto(`/o/${slug}/audit`);
    await expect(member.getByText("Only admins can see the audit log")).toBeVisible();
    await member.goto(`/o/${slug}/billing`);
    await expect(member.getByText("Only admins can change the plan.")).toBeVisible();
    await expect(member.getByRole("button", { name: /Upgrade|Switch/ })).toHaveCount(0);
  });

  await test.step("the invite link can't be used twice", async () => {
    await member.goto(inviteLink);
    await expect(member.getByRole("heading", { name: "This invitation can't be used" })).toBeVisible();
  });

  await test.step("a failed renewal payment, delivered twice", async () => {
    await page.goto(`/o/${slug}/billing`);
    await page.getByRole("button", { name: "Manage payment and invoices" }).click();
    await expect(page).toHaveURL(/\/simulator\/portal/);
    await page.getByLabel(/Deliver every event twice/).check();
    await page.getByRole("button", { name: "Renewal payment fails" }).click();
    const result = page.getByRole("status").filter({ hasText: "invoice.payment_failed" });
    await expect(result).toContainText("invoice.payment_failed: applied, duplicate");
    await expect(result).toContainText("customer.subscription.updated: applied, duplicate");
    await expect(result).toContainText("Now: Pro plan, past due");

    await member.goto(`/o/${slug}`);
    await expect(alert(member)).toContainText("The last payment failed");
    await expect(alert(member)).toContainText("Ask an admin");
  });

  await test.step("payment recovers, then the admin cancels and the period ends", async () => {
    await page.getByRole("button", { name: "Retry succeeds" }).click();
    await expect(page.getByRole("status").filter({ hasText: "invoice.paid" })).toContainText("Now: Pro plan, active");
    await page.getByRole("button", { name: "Cancel at period end" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Now:" })).toContainText("cancels at period end");

    await page.goto(`/o/${slug}`);
    await expect(page.getByText(/The Pro plan ends on/)).toBeVisible();

    await page.goto(`/simulator/portal?org=${slug}`);
    await page.getByRole("button", { name: "Reach the end of the period" }).click();
    await expect(page.getByRole("status").filter({ hasText: "customer.subscription.deleted: applied" })).toContainText("Now: Free plan, canceled");

    await page.goto(`/o/${slug}`);
    await expect(page.getByText("Over the Free plan's limits")).toBeVisible();
    await expect(page.getByText("4 of 3 projects")).toBeVisible();
  });

  await test.step("the audit log shows who did what", async () => {
    await page.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("cell", { name: "billing.subscription_ended" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "invitation.created" })).toBeVisible();
    await page.getByRole("navigation", { name: "Filter" }).getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/type=billing/);
    await expect(page.getByRole("cell", { name: "invitation.created" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "billing.payment_failed" })).toBeVisible();
  });

  await test.step("another tenant's URL is a 404", async () => {
    await page.goto("/o/northline");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  });

  await adminContext.close();
  await memberContext.close();
});

test("platform admin sees every organization", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ops@tenantry.test");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "All organizations" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Northline Freight/ })).toBeVisible();
  await page.getByRole("link", { name: "Payment problems" }).click();
  await expect(page.getByRole("cell", { name: /Glasshouse Bakery/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Northline Freight/ })).toHaveCount(0);
});

test("signed-out visitors are sent to log in", async ({ page }) => {
  await page.goto("/o/northline/billing");
  await expect(page).toHaveURL(/\/login\?next=%2Fo%2Fnorthline%2Fbilling/);
});

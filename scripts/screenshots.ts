// Captures README screenshots from the seeded demo. Needs `npm run dev` and `npm run seed`.
import { chromium, type Browser } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";

async function shoot(browser: Browser, email: string | null, shots: [string, string][], width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (email) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("demo-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
  for (const [path, name] of shots) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: width < 800 });
    console.log(`${OUT}/${name}.png`);
  }
  await context.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  await shoot(browser, null, [["/", "landing"]]);
  await shoot(browser, "maya@northline.test", [
    ["/o/northline", "overview"],
    ["/o/northline/members", "members"],
    ["/o/northline/billing", "billing"],
    ["/o/northline/audit", "audit-log"],
    ["/simulator/portal?org=northline", "simulator-portal"],
  ]);
  await shoot(browser, "lena@glasshouse.test", [["/o/glasshouse", "payment-failed"]]);
  await shoot(browser, "rui@quarry.test", [["/o/quarry/projects", "over-limit"]]);
  await shoot(browser, "ops@tenantry.test", [["/admin", "platform-admin"]]);
  await shoot(browser, "maya@northline.test", [["/o/northline", "mobile-overview"]], 390, 844);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Writes .env.local from the running local Supabase stack.
// Keeps any values you already set (Stripe keys, app URL).
import { execSync } from "node:child_process";
import fs from "node:fs";

const file = ".env.local";
const status = JSON.parse(
  execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString(),
);

const existing = {};
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) existing[m[1]] = m[2];
  }
}

const keep = (key, fallback) => (existing[key] !== undefined ? existing[key] : fallback);

const values = {
  NEXT_PUBLIC_APP_URL: keep("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  STRIPE_SECRET_KEY: keep("STRIPE_SECRET_KEY", ""),
  STRIPE_WEBHOOK_SECRET: keep("STRIPE_WEBHOOK_SECRET", "whsec_local_simulator_secret"),
  STRIPE_PRICE_PRO: keep("STRIPE_PRICE_PRO", ""),
  STRIPE_PRICE_BUSINESS: keep("STRIPE_PRICE_BUSINESS", ""),
  BILLING_SIMULATOR: keep("BILLING_SIMULATOR", ""),
  RESEND_API_KEY: keep("RESEND_API_KEY", ""),
  EMAIL_FROM: keep("EMAIL_FROM", ""),
};

fs.writeFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log(`Wrote ${file} (Supabase at ${status.API_URL}, Studio at ${status.STUDIO_URL})`);

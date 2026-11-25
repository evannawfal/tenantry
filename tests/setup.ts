import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
  if (!process.env[name]) {
    throw new Error(`${name} is missing. Start Supabase with \`npx supabase start\` and run \`npm run env\`.`);
  }
}

// Tests always run the webhook without a real Stripe key.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PRICE_PRO;
delete process.env.STRIPE_PRICE_BUSINESS;
process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_local_simulator_secret";

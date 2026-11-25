import { handleWebhookRequest } from "@/lib/billing/webhook";

// Stripe signs the raw body, so this reads request.text() and never parses
// JSON before verifying. The proxy skips this path.
export async function POST(request: Request) {
  return handleWebhookRequest(request);
}

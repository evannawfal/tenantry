import { NextResponse } from "next/server";
import { createDemoSandbox, demoEnabled } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";

// POST only, from the "Try the demo" button, so link crawlers don't create sandboxes.
export async function POST(request: Request) {
  if (!demoEnabled()) return new Response("Not found", { status: 404 });

  try {
    const sandbox = await createDemoSandbox();
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: sandbox.email, password: sandbox.password });
    if (error) throw error;
    return NextResponse.redirect(new URL(`/o/${sandbox.slug}`, request.url), 303);
  } catch (error) {
    console.error("[demo]", error);
    return NextResponse.redirect(new URL("/?demo=failed", request.url), 303);
  }
}

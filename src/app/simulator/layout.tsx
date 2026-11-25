import { notFound } from "next/navigation";
import { billingMode } from "@/lib/billing/stripe";

export default function SimulatorLayout({ children }: LayoutProps<"/simulator">) {
  // With a real Stripe key these pages don't exist.
  if (billingMode() !== "simulator") notFound();
  return (
    <div className="min-h-dvh bg-[#f3f3f1]">
      <div className="border-b border-line bg-ink px-4 py-2 text-center text-[12px] text-white/80">
        Stripe simulator. Nothing here talks to Stripe; each button sends signed webhook events to this app.
      </div>
      {children}
    </div>
  );
}

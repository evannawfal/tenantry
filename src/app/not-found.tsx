import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Logo href="/o" />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[12vh]">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-medium">Not found</h1>
          <p className="mt-2 text-ink-2">This page doesn&apos;t exist, or it belongs to an organization you aren&apos;t a member of.</p>
          <Link href="/o" className={`${buttonClass("secondary")} mt-6`}>
            Go to your organizations
          </Link>
        </div>
      </main>
    </div>
  );
}

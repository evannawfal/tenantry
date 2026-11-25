import Link from "next/link";
import type { Metadata } from "next";
import { signIn } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : "";
  const linkError = params.error === "link";

  return (
    <>
      <h1 className="text-2xl leading-8 font-medium">Log in</h1>
      <p className="mt-1 text-ink-2">
        No account?{" "}
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>

      {linkError ? (
        <p role="alert" className="mt-6 rounded-lg border border-negative/25 bg-negative-soft px-3 py-2 text-[13px] text-negative">
          That link is invalid or has expired. Log in, or sign up again to get a new one.
        </p>
      ) : null}

      <ActionForm action={signIn} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required minLength={8} className={inputClass} />
        </Field>
        <SubmitButton className="w-full">Log in</SubmitButton>
      </ActionForm>
    </>
  );
}

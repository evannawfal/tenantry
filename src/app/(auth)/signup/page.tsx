import Link from "next/link";
import type { Metadata } from "next";
import { signUp } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : "";
  const invited = next.startsWith("/invite/");

  return (
    <>
      <h1 className="text-2xl leading-8 font-medium">Create an account</h1>
      <p className="mt-1 text-ink-2">
        {invited ? "Use the email address your invitation was sent to. " : null}
        Have one?{" "}
        <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>

      <ActionForm action={signUp} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Your name">
          <input name="name" autoComplete="name" required maxLength={100} className={inputClass} />
        </Field>
        <Field label="Work email">
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <input name="password" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
        </Field>
        <SubmitButton className="w-full">Create account</SubmitButton>
      </ActionForm>
    </>
  );
}

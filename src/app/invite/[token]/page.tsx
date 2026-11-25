import type { Metadata } from "next";
import Link from "next/link";
import { acceptInvitation } from "@/actions/invite";
import { signOut } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Logo, buttonClass } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([supabase.rpc("get_invitation", { p_token: token }), getUser()]);
  const invite = data?.[0];
  const here = `/invite/${token}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[420px]">
          {!invite ? (
            <>
              <h1 className="text-2xl leading-8 font-medium">This invitation can&apos;t be used</h1>
              <p className="mt-2 text-ink-2">
                It was already accepted, revoked by an admin, or it expired. Ask the person who invited you for a new link.
              </p>
              <Link href={user ? "/o" : "/login"} className={`${buttonClass("secondary")} mt-6`}>
                {user ? "Go to your organizations" : "Log in"}
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl leading-8 font-medium">Join {invite.org_name}</h1>
              <p className="mt-2 text-ink-2">
                You&apos;ve been invited as {invite.role === "admin" ? "an admin" : "a member"}. The invitation is for{" "}
                <span className="font-medium text-ink">{invite.email}</span> and expires on {formatDate(invite.expires_at)}.
              </p>

              {!user ? (
                <div className="mt-8 flex gap-2">
                  <Link href={`/signup?next=${encodeURIComponent(here)}`} className={buttonClass("primary")}>
                    Create account
                  </Link>
                  <Link href={`/login?next=${encodeURIComponent(here)}`} className={buttonClass("secondary")}>
                    Log in
                  </Link>
                </div>
              ) : user.email?.toLowerCase() !== invite.email ? (
                <div className="mt-8 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-warning">
                  <p>
                    You&apos;re logged in as {user.email}. Log out, then open this link again and sign in as {invite.email}.
                  </p>
                  <form action={signOut} className="mt-3">
                    <button className={buttonClass("secondary", "sm")}>Log out</button>
                  </form>
                </div>
              ) : (
                <ActionForm action={acceptInvitation} className="mt-8">
                  <input type="hidden" name="token" value={token} />
                  <SubmitButton>Join {invite.org_name}</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

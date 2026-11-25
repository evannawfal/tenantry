"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass } from "./ui";

export type ActionState = { error?: string; ok?: string; link?: string } | null;
type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Runs a server action and shows its result under the form. Submits through
 * onSubmit instead of the action prop so a failed submit keeps what the user typed.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={ref}
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
          startTransition(() => dispatch(data));
        }}
      >
        {children}
        <FormResult state={state} />
      </form>
    </PendingContext.Provider>
  );
}

function FormResult({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div className="basis-full">
      {state.error ? (
        <p role="alert" className="mt-3 text-[13px] text-negative">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-3 text-[13px] text-positive">
          {state.ok}
        </p>
      ) : null}
      {state.link ? <CopyField value={state.link} className="mt-2" /> : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  confirm,
  name,
  value,
  className = "",
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  confirm?: string;
  name?: string;
  value?: string;
  className?: string;
  disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${buttonClass(variant, size)} ${className}`}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

export function CopyField({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex gap-2 ${className}`}>
      <input
        readOnly
        value={value}
        aria-label="Invitation link"
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-ink-2"
      />
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors duration-150 ${
        active ? "bg-card font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

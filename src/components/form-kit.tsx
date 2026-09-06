"use client";

import { useActionState, type ReactNode } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";

import type { ActionResult } from "@/lib/validation";

/**
 * Peças de formulário compartilhadas.
 *
 * Regras de formulário que todas seguem (guideline "Forms & Feedback"):
 * - Rótulo SEMPRE visível. Placeholder como rótulo some quando você digita e
 *   deixa quem voltou ao campo sem saber o que ele era.
 * - Erro ao lado do campo, não só num resumo no topo.
 * - Texto de ajuda antes do erro acontecer, não depois.
 */

export function Field({
  label,
  name,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string[];
  children: ReactNode;
  required?: boolean;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error?.length ? `${name}-error` : undefined;

  return (
    <div className="flex flex-col gap-sm">
      <label htmlFor={name} className="text-xs font-medium">
        {label}
        {required ? (
          <span className="ml-xs text-muted-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
      {error?.length ? (
        <p id={errorId} className="text-[11px] text-neg">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-control border border-border bg-muted px-lg py-md text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors duration-200";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} cursor-pointer ${props.className ?? ""}`} />
  );
}

export function SubmitButton({
  children,
  pending,
}: {
  children: ReactNode;
  pending: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex cursor-pointer items-center justify-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Estado inicial compartilhado por todo formulário que usa useActionState. */
export const IDLE: ActionResult = { ok: true };

/**
 * Envolve um formulário com feedback de sucesso/erro.
 * `useActionState` dá o `pending` sem precisar de estado manual, e o form
 * continua funcionando como HTML se o JS ainda não carregou.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "",
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: (state: ActionResult) => ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  return (
    <form action={formAction} className={`flex flex-col gap-lg ${className}`}>
      {children(state)}

      {!state.ok ? (
        <p
          role="alert"
          className="flex items-start gap-md rounded-control border border-destructive/40 bg-destructive/10 p-lg text-xs text-neg"
        >
          <TriangleAlert className="mt-xs size-4 shrink-0" aria-hidden="true" />
          {state.error}
        </p>
      ) : null}

      {state.ok && state.message ? (
        <p
          role="status"
          className="flex items-center gap-md rounded-control border border-accent/40 bg-accent/10 p-lg text-xs text-pos"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}

      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** Extrai os erros de um campo do ActionResult. */
export function fieldError(state: ActionResult, name: string): string[] | undefined {
  return state.ok ? undefined : state.fieldErrors?.[name];
}

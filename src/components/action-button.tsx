"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import type { ActionResult } from "@/lib/validation";

/**
 * Botão que dispara uma Server Action e mostra o estado de pendência.
 *
 * `confirm` usa confirmação INLINE (o botão vira "Confirmar?") em vez de
 * window.confirm: o diálogo nativo trava a thread, não dá para estilizar e é
 * fácil de aceitar no automático. Aqui a ação destrutiva exige um segundo
 * clique consciente, e dá para desistir clicando fora.
 */
export function ActionButton({
  action,
  children,
  confirm = false,
  confirmLabel = "Confirmar?",
  className = "",
  ariaLabel,
  onDone,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirm?: boolean;
  confirmLabel?: string;
  className?: string;
  ariaLabel?: string;
  onDone?: (result: ActionResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (confirm && !armed) {
      setArmed(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await action();
      setArmed(false);
      if (!result.ok) setError(result.error);
      onDone?.(result);
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-xs">
      <button
        type="button"
        onClick={run}
        onBlur={() => setArmed(false)}
        disabled={isPending}
        aria-label={ariaLabel}
        className={`inline-flex cursor-pointer items-center gap-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
          armed ? "text-neg" : ""
        } ${className}`}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {armed ? confirmLabel : children}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-neg">
          {error}
        </span>
      ) : null}
    </span>
  );
}

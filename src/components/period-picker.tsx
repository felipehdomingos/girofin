"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Seletor de intervalo do relatório. */
export function PeriodPicker({
  de,
  ate,
}: {
  de: string;
  ate: string;
}) {
  const router = useRouter();
  const [inicio, setInicio] = useState(de);
  const [fim, setFim] = useState(ate);

  return (
    <div className="mb-2xl flex flex-wrap items-end gap-md">
      <span className="flex flex-col gap-sm">
        <label htmlFor="de" className="text-[11px] font-medium text-muted-foreground">
          De
        </label>
        <input
          id="de"
          type="date"
          value={inicio}
          onChange={(event) => setInicio(event.target.value)}
          className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm"
        />
      </span>

      <span className="flex flex-col gap-sm">
        <label htmlFor="ate" className="text-[11px] font-medium text-muted-foreground">
          Até
        </label>
        <input
          id="ate"
          type="date"
          value={fim}
          onChange={(event) => setFim(event.target.value)}
          className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm"
        />
      </span>

      <button
        type="button"
        onClick={() => router.push(`/relatorios?periodo=custom&de=${inicio}&ate=${fim}`)}
        disabled={inicio > fim}
        className="cursor-pointer rounded-control border border-border px-xl py-md text-sm font-semibold transition-colors duration-200 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        Aplicar
      </button>

      {inicio > fim ? (
        <p role="alert" className="w-full text-xs text-neg">
          A data inicial precisa ser anterior à final.
        </p>
      ) : null}
    </div>
  );
}

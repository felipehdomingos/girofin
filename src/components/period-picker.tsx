"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Seletor de período do relatório.
 *
 * Os atalhos (semana, mês, ano) cobrem quase tudo com um clique; o customizado
 * existe para o resto. Navega trocando a URL em vez de guardar estado local:
 * assim o período fica no endereço, o botão voltar funciona e dá para
 * compartilhar ou favoritar um recorte específico.
 */
export function PeriodPicker({
  periodo,
  de,
  ate,
}: {
  periodo: string;
  de: string;
  ate: string;
}) {
  const router = useRouter();
  const [inicio, setInicio] = useState(de);
  const [fim, setFim] = useState(ate);

  const atalhos = [
    { id: "semana", label: "Semana" },
    { id: "mes", label: "Mês" },
    { id: "ano", label: "Ano" },
  ] as const;

  return (
    <div className="mb-2xl flex flex-wrap items-end gap-lg">
      <div role="tablist" aria-label="Período" className="flex gap-sm">
        {atalhos.map(({ id, label }) => {
          const ativo = periodo === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => router.push(`/relatorios?periodo=${id}`)}
              className={`cursor-pointer rounded-control border px-xl py-md text-sm transition-colors duration-200 ${
                ativo
                  ? "border-accent bg-accent/15 font-semibold text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-md">
        <span className="flex flex-col gap-sm">
          <label htmlFor="de" className="text-[11px] font-medium text-muted-foreground">
            De
          </label>
          <input
            id="de"
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
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
            onChange={(e) => setFim(e.target.value)}
            className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm"
          />
        </span>

        <button
          type="button"
          onClick={() =>
            router.push(`/relatorios?periodo=custom&de=${inicio}&ate=${fim}`)
          }
          disabled={inicio > fim}
          className="cursor-pointer rounded-control border border-border px-xl py-md text-sm font-semibold transition-colors duration-200 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aplicar
        </button>
      </div>

      {inicio > fim ? (
        <p role="alert" className="w-full text-xs text-neg">
          A data inicial precisa ser anterior à final.
        </p>
      ) : null}
    </div>
  );
}

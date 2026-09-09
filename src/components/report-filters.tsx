"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Filter } from "lucide-react";

import {
  ACCOUNT_KIND_LABEL,
  METHOD_LABEL,
  NATURE_LABEL,
  type Account,
  type Category,
  type IncomeSource,
  type PaymentMethod,
  type TxNature,
  type TxType,
} from "@/lib/types";

const FILTER_KEYS = ["tipo", "categoria", "conta", "metodo", "natureza", "fonte", "busca"] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

export interface ReportFilterValues {
  tipo: TxType | "";
  categoria: string;
  conta: string;
  metodo: PaymentMethod | "";
  natureza: TxNature | "";
  fonte: string;
  busca: string;
}

const selectClassName =
  "w-full cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm text-foreground";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-sm">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function ReportFilters({
  categories,
  accounts,
  incomeSources,
  values,
}: {
  categories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
  values: ReportFilterValues;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasFilters = FILTER_KEYS.some((key) => values[key]);
  const activeFilterCount = FILTER_KEYS.filter((key) => values[key]).length;
  const [open, setOpen] = useState(hasFilters);
  const [draft, setDraft] = useState(values);

  const navigateWithFilters = (nextValues: ReportFilterValues) => {
    const next = new URLSearchParams(searchParams.toString());

    for (const key of FILTER_KEYS) {
      const value = nextValues[key];
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const query = next.toString();
    router.push(query ? `/relatorios?${query}` : "/relatorios");
  };

  const update = <K extends FilterKey>(key: K, value: ReportFilterValues[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateWithFilters(draft);
  };

  const clear = () => {
    const cleared: ReportFilterValues = {
      tipo: "",
      categoria: "",
      conta: "",
      metodo: "",
      natureza: "",
      fonte: "",
      busca: "",
    };
    setDraft(cleared);
    navigateWithFilters(cleared);
  };

  return (
    <div className="mb-2xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="report-filters-panel"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex cursor-pointer items-center gap-md rounded-control border border-border bg-muted px-xl py-md text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-muted/80"
      >
        <Filter className="size-4" aria-hidden="true" />
        <span>{open ? "Ocultar filtros" : "Filtros"}</span>
        {activeFilterCount > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-accent text-xs text-on-accent">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <section id="report-filters-panel" className="glass mt-lg p-xl">
      <div className="mb-lg flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Filtros do relatório</h2>
          <p className="mt-xs text-xs text-muted-foreground">
            Combine os filtros para analisar apenas o recorte que interessa.
          </p>
        </div>
        {hasFilters ? (
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <form onSubmit={apply} className="grid gap-md sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Field label="Tipo de movimentação" htmlFor="relatorio-tipo">
          <select
            id="relatorio-tipo"
            value={draft.tipo}
            onChange={(event) => update("tipo", event.target.value as ReportFilterValues["tipo"])}
            className={selectClassName}
          >
            <option value="">Entradas e saídas</option>
            <option value="INCOME">Somente entradas</option>
            <option value="EXPENSE">Somente saídas</option>
          </select>
        </Field>

        <Field label="Categoria" htmlFor="relatorio-categoria">
          <select
            id="relatorio-categoria"
            value={draft.categoria}
            onChange={(event) => update("categoria", event.target.value)}
            className={selectClassName}
          >
            <option value="">Todas as categorias</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Conta ou cartão" htmlFor="relatorio-conta">
          <select
            id="relatorio-conta"
            value={draft.conta}
            onChange={(event) => update("conta", event.target.value)}
            className={selectClassName}
          >
            <option value="">Todas as contas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {ACCOUNT_KIND_LABEL[account.kind]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Forma de pagamento" htmlFor="relatorio-metodo">
          <select
            id="relatorio-metodo"
            value={draft.metodo}
            onChange={(event) => update("metodo", event.target.value as ReportFilterValues["metodo"])}
            className={selectClassName}
          >
            <option value="">Todas as formas</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((method) => (
              <option key={method} value={method}>
                {METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Natureza do lançamento" htmlFor="relatorio-natureza">
          <select
            id="relatorio-natureza"
            value={draft.natureza}
            onChange={(event) => update("natureza", event.target.value as ReportFilterValues["natureza"])}
            className={selectClassName}
          >
            <option value="">Todas as naturezas</option>
            {(Object.keys(NATURE_LABEL) as TxNature[]).map((nature) => (
              <option key={nature} value={nature}>
                {NATURE_LABEL[nature]}
              </option>
            ))}
          </select>
        </Field>

        {incomeSources.length > 0 ? (
          <Field label="Fonte de renda" htmlFor="relatorio-fonte">
            <select
              id="relatorio-fonte"
              value={draft.fonte}
              onChange={(event) => update("fonte", event.target.value)}
              className={selectClassName}
            >
              <option value="">Todas as fontes</option>
              {incomeSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Busca textual" htmlFor="relatorio-busca">
          <input
            id="relatorio-busca"
            type="search"
            value={draft.busca}
            onChange={(event) => update("busca", event.target.value)}
            placeholder="Descrição, categoria ou observação"
            className="w-full rounded-control border border-border bg-muted px-lg py-md text-sm text-foreground placeholder:text-muted-foreground/60"
          />
        </Field>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full cursor-pointer rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-opacity duration-200 hover:opacity-90"
          >
            Aplicar filtros
          </button>
        </div>
      </form>
        </section>
      ) : null}
    </div>
  );
}

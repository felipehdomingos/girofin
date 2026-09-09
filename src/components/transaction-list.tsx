"use client";

import { useMemo, useState } from "react";
import { Repeat, Trash2 } from "lucide-react";

import { ActionButton } from "./action-button";
import { Badge, CategoryDot, EmptyState, Money } from "./ui";
import { TransactionEditDialog } from "./transaction-edit";
import { deletePurchaseAction, deleteTransactionAction } from "@/lib/actions";
import { formatDay } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import {
  METHOD_LABEL,
  type Account,
  type Category,
  type IncomeSource,
  type TransactionWithCategory,
} from "@/lib/types";

/**
 * Lista do mês com busca e filtro por categoria.
 *
 * Filtragem no cliente porque o conjunto é pequeno por definição (lançamentos
 * de UM mês — dezenas, não milhares) e já veio inteiro do servidor. Ida ao
 * servidor a cada tecla daria latência sem ganho nenhum.
 */
export function TransactionList({
  transactions,
  month,
  allCategories,
  accounts,
  incomeSources,
}: {
  transactions: TransactionWithCategory[];
  month: string;
  /** Todas as categorias, não só as que aparecem na lista: a edição precisa
      poder mover o lançamento para uma categoria ainda não usada no mês. */
  allCategories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const categories = useMemo(() => {
    const map = new Map(transactions.map((t) => [t.category.id, t.category]));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (categoryId && t.category.id !== categoryId) return false;
      if (!q) return true;
      return (
        t.description.toLowerCase().includes(q) ||
        t.category.name.toLowerCase().includes(q)
      );
    });
  }, [transactions, query, categoryId]);

  const total = filtered.reduce(
    (acc, t) => acc + (t.type === "INCOME" ? t.amountCents : -t.amountCents),
    0,
  );

  return (
    <section className="glass p-2xl">
      <div className="mb-xl flex flex-wrap items-center justify-between gap-lg">
        <h2 className="text-sm font-semibold tracking-tight">
          Lançamentos do mês
          <span className="ml-md font-normal text-muted-foreground">
            {filtered.length} de {transactions.length}
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          saldo dos filtrados{" "}
          <span
            className={`font-mono tabular ${total >= 0 ? "text-pos" : "text-neg"}`}
          >
            {total >= 0 ? "+" : "−"}
            {formatBRL(Math.abs(total))}
          </span>
        </span>
      </div>

      {/* Filtros numa linha só, acima da lista. */}
      <div className="mb-xl flex flex-wrap gap-md">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="busca" className="sr-only">
            Buscar lançamento
          </label>
          <input
            id="busca"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descrição ou categoria"
            className="w-full rounded-control border border-border bg-muted px-lg py-md text-sm text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <div>
          <label htmlFor="filtro-cat" className="sr-only">
            Filtrar por categoria
          </label>
          <select
            id="filtro-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm text-foreground"
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {transactions.length === 0 ? (
        <EmptyState title="Nenhum lançamento neste mês">
          Use o lançamento rápido acima: escreva “mercado 152,30” e o app faz o resto.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nada encontrado com esse filtro">
          Limpe a busca ou escolha outra categoria.
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-lg border-b border-border py-lg last:border-0"
            >
              <span className="w-12 shrink-0 font-mono tabular text-xs text-muted-foreground">
                {formatDay(t.date)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-md">
                  <CategoryDot color={t.category.color} />
                  <span className="truncate text-sm">{t.description}</span>
                  {t.nature === "FIXO" ? (
                    <Repeat
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label="Custo fixo"
                    />
                  ) : null}
                  {t.nature === "PARCELADO" && t.installmentNo ? (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {t.installmentNo}/{t.installmentTotal}
                    </span>
                  ) : null}
                </span>
                <span className="mt-xs block truncate pl-[18px] text-xs text-muted-foreground">
                  {/* Em compra no cartão, o dia da compra e o dia em que o
                      dinheiro sai são diferentes — mostrar os dois evita a
                      dúvida de "comprei dia 3, por que está em outubro?". */}
                  {t.purchaseDate ? `comprado ${formatDay(t.purchaseDate)} · ` : ""}
                  {t.method ? `${METHOD_LABEL[t.method]} · ` : ""}
                  {t.accountName ?? "sem carteira"}
                  {t.incomeSourceName ? ` · ${t.incomeSourceName}` : ""}
                  {t.notes ? ` · ${t.notes}` : ""}
                </span>
              </span>

              <Badge>{t.category.name}</Badge>

              <Money
                cents={t.type === "INCOME" ? t.amountCents : -t.amountCents}
                tone="auto"
                size="sm"
                showSign
              />

              {/* Numa compra parcelada, apagar só a parcela do mês deixaria as
                  outras órfãs e o total da compra errado. O padrão aqui é
                  apagar a compra inteira. */}
              <TransactionEditDialog
                transaction={t}
                categories={allCategories}
                accounts={accounts}
                incomeSources={incomeSources}
              />

              <ActionButton
                action={() =>
                  t.purchaseId
                    ? deletePurchaseAction(t.purchaseId)
                    : deleteTransactionAction(t.id)
                }
                confirm
                confirmLabel={
                  t.purchaseId ? `Excluir as ${t.installmentTotal}?` : "Excluir?"
                }
                ariaLabel={
                  t.purchaseId
                    ? `Excluir a compra ${t.description} e todas as parcelas`
                    : `Excluir ${t.description}`
                }
                className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only">Mês exibido: {month}</p>
    </section>
  );
}

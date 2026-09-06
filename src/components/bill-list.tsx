"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Trash2, Undo2 } from "lucide-react";

import { ActionButton } from "./action-button";
import { Badge, CategoryDot, EmptyState, Money } from "./ui";
import {
  deleteBillAction,
  payBillAction,
  payBillQuickAction,
  payCardInvoiceAction,
  unpayBillAction,
} from "@/lib/actions";
import { formatDay } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import type { Account, BillInMonth, BillStatus } from "@/lib/types";

const STATUS_LABEL: Record<BillStatus, string> = {
  PAID: "paga",
  DUE_TODAY: "vence hoje",
  OVERDUE: "vencida",
  UPCOMING: "a vencer",
};

const STATUS_TONE: Record<
  BillStatus,
  "positive" | "warning" | "negative" | "neutral"
> = {
  PAID: "positive",
  DUE_TODAY: "warning",
  OVERDUE: "negative",
  UPCOMING: "neutral",
};

/**
 * Lista de contas do mês com quitação inline.
 *
 * Quitar abre um campo de valor já preenchido com o previsto, em vez de
 * marcar um checkbox: em conta variável (luz, cartão) o valor real quase nunca
 * é o estimado, e registrar o estimado como se fosse o pago corromperia o
 * histórico de gastos com um número que nunca existiu.
 */
export function BillList({
  bills,
  accounts,
  today,
}: {
  bills: BillInMonth[];
  /** Contas de onde pode sair o pagamento de uma fatura. */
  accounts: Account[];
  today: string;
}) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [contaOrigem, setContaOrigem] = useState<Record<string, string>>({});

  // Fatura de cartão nunca é paga por outro cartão.
  const contasParaPagar = accounts.filter((a) => a.kind !== "CARTAO");

  if (bills.length === 0) {
    return (
      <section className="glass p-2xl">
        <h2 className="mb-lg text-sm font-semibold tracking-tight">Contas do mês</h2>
        <EmptyState title="Nenhuma conta cadastrada">
          Cadastre aluguel, luz, internet e assinaturas ao lado. Elas passam a aparecer
          aqui todo mês, e o total em aberto é descontado do seu saldo livre no resumo.
        </EmptyState>
      </section>
    );
  }

  const pending = bills.filter((b) => b.status !== "PAID");
  const totalPending = pending.reduce((acc, b) => acc + b.bill.amountCents, 0);
  const totalPaid = bills
    .filter((b) => b.status === "PAID")
    .reduce((acc, b) => acc + (b.paidCents ?? 0), 0);

  return (
    <section className="glass p-2xl">
      <div className="mb-xl flex flex-wrap items-baseline justify-between gap-lg">
        <h2 className="text-sm font-semibold tracking-tight">Contas do mês</h2>
        <span className="flex flex-wrap gap-lg text-xs text-muted-foreground">
          <span>
            em aberto{" "}
            <span className="font-mono tabular text-neg">{formatBRL(totalPending)}</span>
          </span>
          <span>
            pago{" "}
            <span className="font-mono tabular text-pos">{formatBRL(totalPaid)}</span>
          </span>
        </span>
      </div>

      <ul className="flex flex-col">
        {bills.map((b) => (
          <li
            key={b.bill.id}
            /* Conta vencida ganha faixa vermelha à esquerda e fundo tingido:
               a badge sozinha some no meio de uma lista longa, e atraso é o
               item mais caro da lista (juros + multa). */
            className={`border-b border-border py-lg last:border-0 ${
              b.status === "OVERDUE"
                ? "-mx-lg border-l-2 border-l-destructive bg-destructive/10 pl-lg pr-lg"
                : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-lg">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-md">
                  <CategoryDot color={b.category.color} />
                  <span className="truncate text-sm">{b.bill.name}</span>
                  {b.bill.recurrence === "ONCE" ? <Badge>boleto</Badge> : null}
                  {b.status === "OVERDUE" ? (
                    <AlertTriangle
                      className="size-3.5 shrink-0 text-neg"
                      aria-label="Conta vencida"
                    />
                  ) : null}
                </span>
                <span
                  className={`mt-xs block pl-[18px] text-xs ${
                    b.status === "OVERDUE" ? "text-neg" : "text-muted-foreground"
                  }`}
                >
                  {b.status === "OVERDUE"
                    ? `VENCEU em ${formatDay(b.dueDate)} — ${Math.abs(b.daysUntilDue)} ${
                        Math.abs(b.daysUntilDue) === 1 ? "dia" : "dias"
                      } de atraso`
                    : `vence ${formatDay(b.dueDate)}`}
                  {" · "}
                  {b.category.name}
                  {b.bill.variable ? " · valor estimado" : ""}
                </span>
              </span>

              <Badge tone={STATUS_TONE[b.status]}>
                {b.status === "OVERDUE"
                  ? `vencida há ${Math.abs(b.daysUntilDue)}d`
                  : b.status === "UPCOMING"
                    ? `em ${b.daysUntilDue}d`
                    : STATUS_LABEL[b.status]}
              </Badge>

              <Money
                cents={b.status === "PAID" ? (b.paidCents ?? 0) : b.bill.amountCents}
                size="sm"
                tone={b.status === "PAID" ? "positive" : "neutral"}
              />

              <span className="flex items-center gap-md">
                {b.bill.barcode ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(b.bill.barcode ?? "");
                      setCopiedId(b.bill.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                    aria-label={`Copiar linha digitável de ${b.bill.name}`}
                    className="cursor-pointer rounded-control p-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
                  >
                    {copiedId === b.bill.id ? (
                      <Check className="size-4 text-pos" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                  </button>
                ) : null}

                {/* Fatura de cartão: quitar é TRANSFERIR da conta para o
                    cartão, não gerar uma despesa nova — as compras já foram
                    contadas no mês do vencimento. */}
                {b.bill.id.startsWith("card:") && b.status !== "PAID" ? (
                  contasParaPagar.length === 0 ? (
                    <span className="text-[11px] text-amber-200">
                      Cadastre uma conta para poder quitar
                    </span>
                  ) : (
                    <span className="flex items-center gap-sm">
                      <label className="sr-only" htmlFor={`de-${b.bill.id}`}>
                        Pagar {b.bill.name} com qual conta
                      </label>
                      <select
                        id={`de-${b.bill.id}`}
                        value={contaOrigem[b.bill.id] ?? contasParaPagar[0].id}
                        onChange={(e) =>
                          setContaOrigem((p) => ({
                            ...p,
                            [b.bill.id]: e.target.value,
                          }))
                        }
                        className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs"
                      >
                        {contasParaPagar.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <ActionButton
                        action={() =>
                          payCardInvoiceAction(
                            b.bill.id.replace("card:", ""),
                            contaOrigem[b.bill.id] ?? contasParaPagar[0].id,
                            b.bill.amountCents,
                            today,
                          )
                        }
                        ariaLabel={`Quitar ${b.bill.name}`}
                        className="rounded-control bg-accent px-lg py-sm text-xs font-semibold text-on-accent hover:bg-accent/90"
                      >
                        Pagar fatura
                      </ActionButton>
                    </span>
                  )
                ) : b.status === "PAID" && b.paidTransactionId ? (
                  <ActionButton
                    action={() => unpayBillAction(b.paidTransactionId!)}
                    ariaLabel={`Desfazer pagamento de ${b.bill.name}`}
                    className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                  </ActionButton>
                ) : b.bill.variable ? (
                  // Conta variável: o valor previsto é só estimativa, então o
                  // valor real precisa ser informado. Vai pelo formulário.
                  <button
                    type="button"
                    onClick={() =>
                      setPayingId(payingId === b.bill.id ? null : b.bill.id)
                    }
                    aria-expanded={payingId === b.bill.id}
                    className="cursor-pointer rounded-control bg-accent px-lg py-sm text-xs font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
                  >
                    Informar valor
                  </button>
                ) : (
                  // Conta de valor fixo: um clique quita pelo valor previsto e
                  // já dá baixa no saldo. Abrir formulário para confirmar um
                  // número que já está na tela seria atrito puro.
                  <span className="flex items-center gap-sm">
                    <ActionButton
                      action={() => payBillQuickAction(b.bill.id)}
                      ariaLabel={`Marcar ${b.bill.name} como paga`}
                      className="rounded-control bg-accent px-lg py-sm text-xs font-semibold text-on-accent hover:bg-accent/90"
                    >
                      Pago
                    </ActionButton>
                    <button
                      type="button"
                      onClick={() =>
                        setPayingId(payingId === b.bill.id ? null : b.bill.id)
                      }
                      aria-expanded={payingId === b.bill.id}
                      className="cursor-pointer rounded-control px-sm py-sm text-[11px] text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-foreground hover:underline"
                    >
                      outro valor
                    </button>
                  </span>
                )}

                <ActionButton
                  action={() => deleteBillAction(b.bill.id)}
                  confirm
                  confirmLabel="Excluir?"
                  ariaLabel={`Excluir ${b.bill.name}`}
                  className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </ActionButton>
              </span>
            </div>

            {payingId === b.bill.id ? (
              <form
                action={async (formData) => {
                  await payBillAction(formData);
                  setPayingId(null);
                }}
                className="mt-lg flex flex-wrap items-end gap-md rounded-control border border-border bg-muted/50 p-lg"
              >
                <input type="hidden" name="billId" value={b.bill.id} />

                <span className="flex flex-col gap-sm">
                  <label
                    htmlFor={`pay-amount-${b.bill.id}`}
                    className="text-[11px] font-medium"
                  >
                    Valor pago
                  </label>
                  <input
                    id={`pay-amount-${b.bill.id}`}
                    name="amount"
                    required
                    inputMode="decimal"
                    /* Pré-preenchido com o previsto: na conta de valor fixo
                       basta confirmar; na variável, basta corrigir. */
                    defaultValue={(b.bill.amountCents / 100)
                      .toFixed(2)
                      .replace(".", ",")}
                    className="w-32 rounded-control border border-border bg-background px-lg py-md font-mono text-sm"
                  />
                </span>

                <span className="flex flex-col gap-sm">
                  <label
                    htmlFor={`pay-date-${b.bill.id}`}
                    className="text-[11px] font-medium"
                  >
                    Data do pagamento
                  </label>
                  <input
                    id={`pay-date-${b.bill.id}`}
                    name="date"
                    type="date"
                    required
                    defaultValue={today}
                    className="rounded-control border border-border bg-background px-lg py-md text-sm"
                  />
                </span>

                <button
                  type="submit"
                  className="cursor-pointer rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => setPayingId(null)}
                  className="cursor-pointer rounded-control border border-border px-xl py-md text-sm transition-colors duration-200 hover:bg-muted"
                >
                  Cancelar
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

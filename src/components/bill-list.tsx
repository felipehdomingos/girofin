"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Trash2, Undo2 } from "lucide-react";

import { ActionButton } from "./action-button";
import { Badge, CategoryDot, EmptyState, Money } from "./ui";
import {
  deleteBillAction,
  payBillAction,
  payCardInvoiceAction,
  payScheduledAction,
  unpayBillAction,
} from "@/lib/actions";
import { formatDay } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { ACCOUNT_KIND_LABEL, type Account, type BillInMonth, type BillStatus } from "@/lib/types";

const STATUS_LABEL: Record<BillStatus, string> = {
  PAID: "paga",
  DUE_TODAY: "vence hoje",
  OVERDUE: "vencida",
  UPCOMING: "a vencer",
};

const STATUS_TONE: Record<BillStatus, "positive" | "warning" | "negative" | "neutral"> = {
  PAID: "positive",
  DUE_TODAY: "warning",
  OVERDUE: "negative",
  UPCOMING: "neutral",
};

/**
 * Contas do mês, com quitação inline.
 *
 * TODO pagamento pergunta de qual conta o dinheiro sai — não existe mais o
 * "pagar em um clique" sem origem. Sem isso o saldo das contas para de bater
 * com o extrato: a conta é quitada, mas o dinheiro não sai de lugar nenhum.
 *
 * Fatura de cartão é o caso especial: quitá-la é TRANSFERÊNCIA (sai da conta,
 * zera o cartão), não despesa nova — as compras já foram contadas no mês do
 * vencimento.
 */
export function BillList({
  bills,
  accounts,
  today,
}: {
  bills: BillInMonth[];
  accounts: Account[];
  today: string;
}) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [origem, setOrigem] = useState<Record<string, string>>({});
  const [valores, setValores] = useState<Record<string, string>>({});

  // Fatura de cartão não se paga com outro cartão, e conta comum também não.
  const contasPagadoras = accounts.filter((a) => a.kind !== "CARTAO");

  if (bills.length === 0) {
    return (
      <section className="glass p-2xl">
        <h2 className="mb-lg text-sm font-semibold tracking-tight">Contas do mês</h2>
        <EmptyState title="Nada a pagar neste mês">
          Cadastre aluguel, luz, internet e assinaturas no botão acima. A fatura dos seus
          cartões aparece aqui sozinha, no mês em que vence.
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
            pago <span className="font-mono tabular text-pos">{formatBRL(totalPaid)}</span>
          </span>
        </span>
      </div>

      <ul className="flex flex-col">
        {bills.map((b) => {
          const ehFatura = b.bill.id.startsWith("card:");
          // Lançamento com data futura, listado aqui como compromisso.
          const ehAgendado = b.bill.id.startsWith("tx:");
          const abertoParaPagar = payingId === b.bill.id;
          const contaEscolhida = origem[b.bill.id] ?? contasPagadoras[0]?.id ?? "";
          const valorTexto =
            valores[b.bill.id] ??
            (b.bill.amountCents / 100).toFixed(2).replace(".", ",");

          return (
            <li
              key={b.bill.id}
              /* Conta vencida ganha faixa vermelha e fundo tingido: a badge
                 sozinha some no meio de uma lista longa, e atraso é o item mais
                 caro (juros + multa). */
              className={`border-b border-border py-lg last:border-0 ${
                b.status === "OVERDUE"
                  ? "-mx-lg border-l-2 border-l-destructive bg-destructive/10 px-lg"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-lg">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-md">
                    <CategoryDot color={b.category.color} />
                    <span className="truncate text-sm">{b.bill.name}</span>
                    {ehFatura ? <Badge tone="info">fatura</Badge> : null}
                    {ehAgendado ? <Badge tone="info">agendado</Badge> : null}
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
                    {b.bill.variable && !ehFatura ? " · valor estimado" : ""}
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

                  {b.status === "PAID" && b.paidTransactionId ? (
                    <ActionButton
                      action={() => unpayBillAction(b.paidTransactionId!)}
                      ariaLabel={`Desfazer pagamento de ${b.bill.name}`}
                      className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Undo2 className="size-4" aria-hidden="true" />
                    </ActionButton>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPayingId(abertoParaPagar ? null : b.bill.id)}
                      aria-expanded={abertoParaPagar}
                      className="cursor-pointer rounded-control bg-accent px-lg py-sm text-xs font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
                    >
                      {abertoParaPagar ? "Cancelar" : "Pagar"}
                    </button>
                  )}

                  {/* Fatura é sintetizada a partir das compras — não existe
                      registro para excluir. */}
                  {ehFatura || ehAgendado ? null : (
                    <ActionButton
                      action={() => deleteBillAction(b.bill.id)}
                      confirm
                      confirmLabel="Excluir?"
                      ariaLabel={`Excluir ${b.bill.name}`}
                      className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </ActionButton>
                  )}
                </span>
              </div>

              {abertoParaPagar ? (
                <div className="mt-lg rounded-control border border-border bg-muted/50 p-lg">
                  {contasPagadoras.length === 0 ? (
                    <p className="text-xs text-amber-200">
                      Cadastre uma conta em Configurações para poder registrar
                      pagamentos — o dinheiro precisa sair de algum lugar.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-md">
                      <span className="flex flex-col gap-sm">
                        <label
                          htmlFor={`origem-${b.bill.id}`}
                          className="text-[11px] font-medium"
                        >
                          Sai de qual conta
                        </label>
                        <select
                          id={`origem-${b.bill.id}`}
                          value={contaEscolhida}
                          onChange={(e) =>
                            setOrigem((p) => ({ ...p, [b.bill.id]: e.target.value }))
                          }
                          className="cursor-pointer rounded-control border border-border bg-background px-lg py-md text-sm"
                        >
                          {contasPagadoras.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} — {ACCOUNT_KIND_LABEL[c.kind]}
                            </option>
                          ))}
                        </select>
                      </span>

                      <span className="flex flex-col gap-sm">
                        <label
                          htmlFor={`valor-${b.bill.id}`}
                          className="text-[11px] font-medium"
                        >
                          Valor pago
                        </label>
                        <input
                          id={`valor-${b.bill.id}`}
                          value={valorTexto}
                          onChange={(e) =>
                            setValores((p) => ({ ...p, [b.bill.id]: e.target.value }))
                          }
                          inputMode="decimal"
                          className="w-32 rounded-control border border-border bg-background px-lg py-md font-mono text-sm"
                        />
                      </span>

                      <ActionButton
                        action={async () => {
                          const cents = Math.round(
                            Number(valorTexto.replace(/\./g, "").replace(",", ".")) *
                              100,
                          );

                          // Lançamento agendado: ATUALIZA a linha existente.
                          // Criar outra contaria o mesmo gasto duas vezes.
                          if (ehAgendado) {
                            const r = await payScheduledAction(
                              b.bill.id.replace("tx:", ""),
                              contaEscolhida,
                              cents,
                              today,
                            );
                            if (r.ok) setPayingId(null);
                            return r;
                          }

                          if (ehFatura) {
                            // Fatura: transferência, não despesa.
                            const r = await payCardInvoiceAction(
                              b.bill.id.replace("card:", ""),
                              contaEscolhida,
                              cents,
                              today,
                            );
                            if (r.ok) setPayingId(null);
                            return r;
                          }

                          const fd = new FormData();
                          fd.set("billId", b.bill.id);
                          fd.set("amount", valorTexto);
                          fd.set("date", today);
                          fd.set("accountId", contaEscolhida);
                          const r = await payBillAction(fd);
                          if (r.ok) setPayingId(null);
                          return r;
                        }}
                        className="rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent hover:bg-accent/90"
                      >
                        Confirmar pagamento
                      </ActionButton>
                    </div>
                  )}

                  {ehFatura ? (
                    <p className="mt-md text-[11px] leading-relaxed text-muted-foreground">
                      Pagar a fatura <strong>não</strong> gera um gasto novo: as compras
                      já foram contadas no mês do vencimento. O dinheiro só sai da conta
                      escolhida e zera o cartão.
                    </p>
                  ) : ehAgendado ? (
                    <p className="mt-md text-[11px] leading-relaxed text-muted-foreground">
                      Este lançamento já existe agendado. Confirmar <strong>atualiza</strong>{" "}
                      a linha com a conta e o valor reais — não cria um gasto novo.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

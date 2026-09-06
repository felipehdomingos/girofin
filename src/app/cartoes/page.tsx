import Link from "next/link";
import { CreditCard } from "lucide-react";

import { InvoiceImport } from "@/components/invoice-import";
import { ManualEntry } from "@/components/manual-entry";
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader, ProgressBar } from "@/components/ui";
import { MonthNav } from "@/components/month-nav";
import { currentMonth, formatDay, today } from "@/lib/dates";
import { formatBRL, safePercent } from "@/lib/money";
import {
  getCardInvoice,
  listAccounts,
  listAccountsWithBalance,
  listCategories,
  listIncomeSources,
  listTransactionsInRange,
} from "@/lib/repo";
import { monthBounds } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Tela dos cartões de crédito: a fatura do mês, as compras dela, e as duas
 * formas de alimentar isso — importando o PDF da fatura ou lançando à mão.
 */
export default async function CartoesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; cartao?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : currentMonth();

  const cartoes = listAccountsWithBalance(month).filter((a) => a.kind === "CARTAO");
  const categories = listCategories();

  if (cartoes.length === 0) {
    return (
      <>
        <PageHeader title="Cartões de crédito" />
        <Card>
          <EmptyState title="Nenhum cartão cadastrado">
            Cadastre um cartão em Configurações para importar faturas e acompanhar o
            limite.{" "}
            <Link
              href="/configuracoes"
              className="cursor-pointer underline underline-offset-4"
            >
              Ir para Configurações
            </Link>
          </EmptyState>
        </Card>
      </>
    );
  }

  // Cartão selecionado pela URL, com o primeiro como padrão.
  const cartao = cartoes.find((c) => c.id === params.cartao) ?? cartoes[0];
  const { start, end } = monthBounds(month);

  const faturaCents = getCardInvoice(cartao.id, month);
  const comprasDoMes = listTransactionsInRange(start, end).filter(
    (t) => t.accountId === cartao.id && t.type === "EXPENSE",
  );

  const usado = Math.abs(cartao.balanceCents);
  const pctLimite = cartao.creditLimitCents
    ? safePercent(usado, cartao.creditLimitCents)
    : null;

  return (
    <>
      <PageHeader
        title="Cartões de crédito"
        subtitle="Fatura do mês, importação do PDF e lançamento de compras"
        actions={<MonthNav month={month} basePath="/cartoes" />}
      />

      {/* Seletor só aparece com mais de um cartão: com um só, seria ruído. */}
      {cartoes.length > 1 ? (
        <div role="tablist" aria-label="Cartões" className="mb-2xl flex flex-wrap gap-sm">
          {cartoes.map((c) => {
            const ativo = c.id === cartao.id;
            return (
              <Link
                key={c.id}
                href={`/cartoes?mes=${month}&cartao=${c.id}`}
                role="tab"
                aria-selected={ativo}
                className={`flex cursor-pointer items-center gap-md rounded-control border px-xl py-md text-sm transition-colors duration-200 ${
                  ativo
                    ? "border-accent bg-accent/15 font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <CreditCard className="size-4" aria-hidden="true" />
                {c.name}
                {c.last4 ? (
                  <span className="font-mono text-[11px]">••{c.last4}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      <Card>
        <CardTitle
          hint={
            cartao.closingDay && cartao.dueDay
              ? `fecha dia ${cartao.closingDay} · vence dia ${cartao.dueDay}`
              : undefined
          }
        >
          {cartao.name}
          {cartao.last4 ? (
            <span className="ml-md font-mono text-xs text-muted-foreground">
              •••• {cartao.last4}
            </span>
          ) : null}
        </CardTitle>

        <div className="grid gap-lg sm:grid-cols-3">
          <div className="rounded-control border border-border bg-muted/40 p-lg">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fatura deste mês
            </p>
            <p className="mt-sm">
              <Money cents={faturaCents} size="lg" tone="negative" />
            </p>
            <p className="mt-xs text-[11px] text-muted-foreground">
              {comprasDoMes.length}{" "}
              {comprasDoMes.length === 1 ? "lançamento" : "lançamentos"}
            </p>
          </div>

          <div className="rounded-control border border-border bg-muted/40 p-lg">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total em aberto
            </p>
            <p className="mt-sm">
              <Money cents={usado} size="lg" tone="negative" />
            </p>
            <p className="mt-xs text-[11px] text-muted-foreground">
              Somando todas as faturas
            </p>
          </div>

          {cartao.creditLimitCents ? (
            <div className="rounded-control border border-border bg-muted/40 p-lg">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Limite disponível
              </p>
              <p className="mt-sm">
                <Money
                  cents={Math.max(cartao.creditLimitCents - usado, 0)}
                  size="lg"
                  tone="positive"
                />
              </p>
              <p className="mt-xs text-[11px] text-muted-foreground">
                de {formatBRL(cartao.creditLimitCents)}
              </p>
            </div>
          ) : null}
        </div>

        {pctLimite !== null ? (
          <div className="mt-xl">
            <ProgressBar
              value={usado}
              max={cartao.creditLimitCents ?? 1}
              label={`${cartao.name}: ${pctLimite.toFixed(0)}% do limite usado`}
              tone={pctLimite > 80 ? "negative" : pctLimite > 50 ? "warning" : "positive"}
            />
            <p className="mt-xs text-[11px] text-muted-foreground">
              {pctLimite.toFixed(0)}% do limite comprometido
            </p>
          </div>
        ) : null}
      </Card>

      <div className="mt-xl">
        <InvoiceImport card={cartao} categories={categories} periodoPadrao={month} />
      </div>

      <div className="mt-xl grid gap-xl lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle hint={`${comprasDoMes.length} no mês`}>
            Compras nesta fatura
          </CardTitle>

          {comprasDoMes.length === 0 ? (
            <EmptyState title="Nenhuma compra nesta fatura">
              Importe o PDF acima ou lance a compra ao lado.
            </EmptyState>
          ) : (
            <ul className="flex flex-col">
              {comprasDoMes.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-lg border-b border-border py-lg last:border-0"
                >
                  <span className="w-12 shrink-0 font-mono tabular text-xs text-muted-foreground">
                    {formatDay(t.purchaseDate ?? t.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.category.name}
                      {t.purchaseDate ? ` · comprado ${formatDay(t.purchaseDate)}` : ""}
                    </span>
                  </span>
                  {t.nature === "PARCELADO" ? <Badge tone="info">parcelado</Badge> : null}
                  <Money cents={t.amountCents} size="sm" tone="negative" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ManualEntry
          categories={categories}
          accounts={listAccounts()}
          incomeSources={listIncomeSources()}
          today={today()}
        />
      </div>
    </>
  );
}

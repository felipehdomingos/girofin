import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";

import {
  Badge,
  Card,
  CardTitle,
  CategoryDot,
  EmptyState,
  Money,
  PageHeader,
  ProgressBar,
  StatCard,
} from "@/components/ui";
import { BalancesCard } from "@/components/balances-card";
import { EntryDialog } from "@/components/entry-dialog";
import {
  currentMonth,
  formatDay,
  formatMonthLong,
  monthProgress,
  today,
} from "@/lib/dates";
import { formatBRL, safePercent } from "@/lib/money";
import {
  getBillsForMonth,
  getMonthSummary,
  getOpenBillsTotal,
  listAccounts,
  listAccountsWithBalance,
  listCategories,
  listIncomeSources,
  listTransactions,
} from "@/lib/repo";
import { KIND_LABEL, KIND_TARGET, type CategoryKind } from "@/lib/types";
import { currentUser, requirePageUser } from "@/lib/auth-http";

/**
 * Resumo do mês — a tela que responde "como eu estou?" em cinco segundos.
 *
 * Server Component: os dados vêm do SQLite direto na renderização, sem
 * useEffect e sem estado de loading no cliente. (Guideline nextjs: "Fetch data
 * in Server Components", severidade High.)
 */
/** Lê o SQLite a cada requisição — sem isso o Next congelaria o estado do build. */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const user = await currentUser();
  const month = currentMonth();
  const summary = await getMonthSummary(month);
  const bills = await getBillsForMonth(month);
  const openBillsCents = await getOpenBillsTotal(month);
  const recent = await listTransactions({ month, limit: 8 });
  const progress = monthProgress(month);
  const accounts = await listAccounts();
  const accountsWithBalance = await listAccountsWithBalance(month);

  const pending = bills.filter((b) => b.status !== "PAID");
  const overdue = bills.filter((b) => b.status === "OVERDUE");

  // A pergunta que o usuário realmente tem não é "quanto sobrou", é "quanto
  // sobrou DEPOIS do que já tem dono". Esse é o número que evita gastar
  // dinheiro que já está comprometido com boleto em aberto.
  const reallyFreeCents = summary.balanceCents - openBillsCents;

  return (
    <>
      <PageHeader
        title={user?.name ? `Olá, ${user.name}` : "Resumo"}
        subtitle={`${formatMonthLong(month)} · dia ${progress.elapsed} de ${progress.total}`}
        actions={
          <EntryDialog
            categories={await listCategories()}
            accounts={accounts}
            incomeSources={await listIncomeSources()}
            today={today()}
          />
        }
      />

      {overdue.length > 0 ? (
        <div
          role="alert"
          className="mb-2xl flex items-start gap-lg rounded-card border border-destructive/40 bg-destructive/10 p-xl"
        >
          <AlertTriangle className="mt-xs size-5 shrink-0 text-neg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">
              {overdue.length === 1
                ? `${overdue[0].bill.name} está vencida`
                : `${overdue.length} contas vencidas`}
            </p>
            <p className="mt-xs text-xs text-muted-foreground">
              Total de {formatBRL(overdue.reduce((a, b) => a + b.bill.amountCents, 0))}.{" "}
              <Link href="/contas" className="cursor-pointer underline underline-offset-4">
                Ver contas
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-xl sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entradas" cents={summary.incomeCents} tone="positive" direction="in" />
        <StatCard label="Saídas" cents={summary.expenseCents} tone="negative" direction="out" />
        <StatCard
          label="Saldo do mês"
          cents={summary.balanceCents}
          tone="auto"
          hint={summary.balanceCents < 0 ? "Você gastou mais do que recebeu" : undefined}
        />
        <StatCard
          label="Livre de verdade"
          cents={reallyFreeCents}
          tone="auto"
          hint={
            openBillsCents > 0
              ? `Já descontadas ${pending.length} ${pending.length === 1 ? "conta" : "contas"} em aberto (${formatBRL(openBillsCents)})`
              : "Nenhuma conta em aberto"
          }
        />
      </div>

      <div className="mt-xl">
        <BalancesCard accounts={accountsWithBalance} />
      </div>

      <div className="mt-xl grid gap-xl lg:grid-cols-2">
        <Card>
          <CardTitle hint="regra 50/30/20">Para onde foi o dinheiro</CardTitle>
          {summary.expenseCents === 0 ? (
            <EmptyState title="Nenhuma saída neste mês">
              Assim que você lançar o primeiro gasto, a divisão aparece aqui.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-xl">
              {(["NEED", "WANT", "SAVE"] as CategoryKind[]).map((kind) => {
                const cents = summary.byKind[kind];
                const pct = safePercent(cents, summary.incomeCents || summary.expenseCents);
                const target = KIND_TARGET[kind];
                // Poupar acima da meta é bom; gastar acima é ruim. O mesmo
                // "passou do alvo" tem sinal oposto nos dois casos.
                const over = kind === "SAVE" ? pct < target : pct > target;

                return (
                  <li key={kind}>
                    <div className="mb-md flex items-baseline justify-between gap-md">
                      <span className="text-sm">
                        {KIND_LABEL[kind]}{" "}
                        <span className="text-xs text-muted-foreground">
                          (meta {target}%)
                        </span>
                      </span>
                      <span className="flex items-baseline gap-md">
                        <Money cents={cents} size="sm" />
                        <Badge tone={over ? "warning" : "positive"}>
                          {pct.toFixed(0)}%
                        </Badge>
                      </span>
                    </div>
                    <ProgressBar
                      value={pct}
                      max={100}
                      label={`${KIND_LABEL[kind]}: ${pct.toFixed(0)}% da renda`}
                      tone={over ? "warning" : "positive"}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            hint={
              <Link href="/contas" className="cursor-pointer underline underline-offset-4">
                ver todas
              </Link>
            }
          >
            Próximas contas
          </CardTitle>
          {pending.length === 0 ? (
            <EmptyState title="Nada em aberto neste mês">
              Cadastre suas contas fixas e boletos para acompanhar os vencimentos aqui.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-md">
              {pending.slice(0, 6).map((b) => (
                <li
                  key={b.bill.id}
                  className="flex items-center justify-between gap-lg border-b border-border pb-md last:border-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-md">
                    <CalendarClock
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{b.bill.name}</span>
                      <span className="text-xs text-muted-foreground">
                        vence {formatDay(b.dueDate)}
                        {b.bill.variable ? " · valor estimado" : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-md">
                    <Money cents={b.bill.amountCents} size="sm" />
                    <Badge
                      tone={
                        b.status === "OVERDUE"
                          ? "negative"
                          : b.status === "DUE_TODAY"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {b.status === "OVERDUE"
                        ? `${Math.abs(b.daysUntilDue)}d atrás`
                        : b.status === "DUE_TODAY"
                          ? "hoje"
                          : `em ${b.daysUntilDue}d`}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-xl grid gap-xl lg:grid-cols-2">
        <Card>
          <CardTitle hint={`${summary.byCategory.length} categorias`}>
            Maiores gastos do mês
          </CardTitle>
          {summary.byCategory.length === 0 ? (
            <EmptyState title="Sem gastos lançados" />
          ) : (
            <ul className="flex flex-col gap-lg">
              {summary.byCategory.slice(0, 6).map((c) => (
                <li key={c.category.id}>
                  <div className="mb-sm flex items-baseline justify-between gap-md">
                    <span className="flex min-w-0 items-center gap-md text-sm">
                      <CategoryDot color={c.category.color} />
                      <span className="truncate">{c.category.name}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-md">
                      <Money cents={c.totalCents} size="sm" />
                      <span className="w-10 text-right text-xs text-muted-foreground">
                        {c.share.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={c.share}
                    max={100}
                    label={`${c.category.name}: ${c.share.toFixed(0)}% das saídas`}
                    tone={
                      c.budgetUsedPct !== null && c.budgetUsedPct > 100
                        ? "negative"
                        : "neutral"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle
            hint={
              <Link
                href="/lancamentos"
                className="cursor-pointer underline underline-offset-4"
              >
                ver todos
              </Link>
            }
          >
            Últimos lançamentos
          </CardTitle>
          {recent.length === 0 ? (
            <EmptyState title="Nenhum lançamento ainda">
              Escreva “mercado 152,30” no lançamento rápido e o resto é automático.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-md">
              {recent.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-lg border-b border-border pb-md last:border-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-md">
                    <CategoryDot color={t.category.color} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{t.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDay(t.date)} · {t.category.name}
                      </span>
                    </span>
                  </span>
                  <Money
                    cents={t.type === "INCOME" ? t.amountCents : -t.amountCents}
                    tone="auto"
                    size="sm"
                    showSign
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Link
        href="/economia"
        className="mt-xl flex cursor-pointer items-center justify-between gap-lg rounded-card border border-border bg-muted/40 p-xl transition-colors duration-200 hover:border-secondary"
      >
        <span>
          <span className="block text-sm font-semibold">Onde dá para economizar</span>
          <span className="mt-xs block text-xs text-muted-foreground">
            Diagnóstico do mês com valores concretos e o que cada corte vira investido.
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </>
  );
}


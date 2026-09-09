import {
  AlertTriangle,
  CheckCircle2,
  Info,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

import { CategoryBarChart, MonthlyTrendChart } from "@/components/charts";
import { GoalManager } from "@/components/goal-manager";
import { Card, CardTitle, EmptyState, Money, PageHeader } from "@/components/ui";
import { buildAdvice, totalPotentialSaving, type AdviceSeverity } from "@/lib/advice";
import { getRates } from "@/lib/bcb";
import { addMonths, currentMonth, formatMonthLong } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import {
  getBillsForMonth,
  getMonthSummary,
  getMonthlySeries,
  getRecurringMonthlyTotal,
  getTotalSavedAllTime,
  listGoals,
} from "@/lib/repo";
import { requirePageUser } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico do mês: o que está fora do lugar, quanto custa, e o que fazer.
 * Cada conselho traz um número e um passo — sem isso é horóscopo financeiro.
 */
export default async function EconomiaPage() {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const month = currentMonth();
  const summary = await getMonthSummary(month);
  const previous = await getMonthSummary(addMonths(month, -1));
  const bills = await getBillsForMonth(month);
  const recurringMonthlyCents = await getRecurringMonthlyTotal();
  const emergencyFundCents = await getTotalSavedAllTime();
  const goals = await listGoals();
  const series = await getMonthlySeries(month, 6);

  const rates = await getRates();
  const annualRatePct = rates.cdi.annualPct;

  // Referência de 6 meses de custo — o padrão de reserva de emergência.
  const hasEmergencyFund =
    summary.expenseCents > 0 && emergencyFundCents >= summary.expenseCents * 6;

  const advice = buildAdvice({
    summary,
    previous,
    bills,
    recurringMonthlyCents,
    annualRatePct,
    hasEmergencyFund,
    emergencyFundCents,
  });

  const potentialMonthly = totalPotentialSaving(advice);

  const categoryData = summary.byCategory.map((c) => ({
    name: c.category.name,
    cents: c.totalCents,
    color: c.category.color,
    share: c.share,
  }));

  return (
    <>
      <PageHeader
        title="Onde economizar"
        subtitle={`Diagnóstico de ${formatMonthLong(month)}`}
      />

      {potentialMonthly > 0 ? (
        <Card className="mb-xl">
          <div className="flex flex-wrap items-center justify-between gap-lg">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Potencial de economia identificado
              </p>
              <p className="mt-md">
                <Money cents={potentialMonthly} size="xl" tone="positive" />
                <span className="ml-md text-sm text-muted-foreground">por mês</span>
              </p>
            </div>
            <p className="flex max-w-sm items-start gap-md text-xs leading-relaxed text-muted-foreground">
              <TrendingUp className="mt-xs size-4 shrink-0 text-accent" aria-hidden="true" />
              Somando os pontos abaixo. Investido a{" "}
              {annualRatePct.toFixed(1).replace(".", ",")}% a.a., isso vira{" "}
              <span className="font-mono tabular text-pos">
                {formatBRL(
                  Math.round(
                    potentialMonthly *
                      ((Math.pow(1 + annualRatePct / 100, 5) - 1) /
                        (Math.pow(1 + annualRatePct / 100, 1 / 12) - 1)),
                  ),
                )}
              </span>{" "}
              em 5 anos.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-xl lg:grid-cols-2">
        <div className="flex flex-col gap-lg">
          <h2 className="text-sm font-semibold tracking-tight">
            Diagnóstico
            <span className="ml-md font-normal text-muted-foreground">
              {advice.length} {advice.length === 1 ? "ponto" : "pontos"}
            </span>
          </h2>

          {advice.map((a) => (
            <AdviceCard key={a.id} {...a} />
          ))}
        </div>

        <div className="flex flex-col gap-xl">
          {categoryData.length > 0 ? (
            <CategoryBarChart data={categoryData} />
          ) : (
            <Card>
              <CardTitle>Gastos por categoria</CardTitle>
              <EmptyState title="Sem gastos lançados neste mês" />
            </Card>
          )}

          <MonthlyTrendChart data={series} />
        </div>
      </div>

      <div className="mt-xl">
        <GoalManager goals={goals} annualRatePct={annualRatePct} />
      </div>
    </>
  );
}

const SEVERITY_STYLE: Record<
  AdviceSeverity,
  { border: string; icon: typeof Info; iconClass: string }
> = {
  critical: {
    border: "border-destructive/40 bg-destructive/5",
    icon: AlertTriangle,
    iconClass: "text-neg",
  },
  warning: {
    border: "border-amber-500/40 bg-amber-500/5",
    icon: TriangleAlert,
    iconClass: "text-amber-300",
  },
  info: { border: "border-border", icon: Info, iconClass: "text-secondary" },
  success: {
    border: "border-accent/40 bg-accent/5",
    icon: CheckCircle2,
    iconClass: "text-pos",
  },
};

function AdviceCard({
  severity,
  title,
  body,
  action,
  monthlySavingCents,
  fiveYearCents,
}: {
  severity: AdviceSeverity;
  title: string;
  body: string;
  action?: string;
  monthlySavingCents?: number;
  fiveYearCents?: number;
}) {
  const style = SEVERITY_STYLE[severity];
  const Icon = style.icon;

  return (
    <article className={`rounded-card border p-xl ${style.border}`}>
      <div className="flex items-start gap-lg">
        {/* Ícone + cor + texto: a severidade nunca depende só da cor. */}
        <Icon className={`mt-xs size-5 shrink-0 ${style.iconClass}`} aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-sm text-xs leading-relaxed text-muted-foreground">{body}</p>

          {action ? (
            <p className="mt-md rounded-control bg-muted/60 px-lg py-md text-xs leading-relaxed">
              <span className="font-semibold">O que fazer: </span>
              {action}
            </p>
          ) : null}

          {monthlySavingCents && monthlySavingCents > 0 ? (
            <p className="mt-md flex flex-wrap gap-lg text-xs">
              <span className="text-muted-foreground">
                por mês:{" "}
                <span className="font-mono tabular text-pos">
                  {formatBRL(monthlySavingCents)}
                </span>
              </span>
              {fiveYearCents ? (
                <span className="text-muted-foreground">
                  investido em 5 anos:{" "}
                  <span className="font-mono tabular text-pos">
                    {formatBRL(fiveYearCents)}
                  </span>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}


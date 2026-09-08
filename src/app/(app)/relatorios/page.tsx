import { CategoryBarChart, TrendChart } from "@/components/charts";
import { EntryDialog } from "@/components/entry-dialog";
import { PeriodPicker } from "@/components/period-picker";
import { TransactionList } from "@/components/transaction-list";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  Money,
  PageHeader,
  ProgressBar,
  StatCard,
} from "@/components/ui";
import {
  addMonthsToDate,
  currentMonth,
  daysInRange,
  formatRange,
  monthBounds,
  today,
  weekBounds,
  yearBounds,
} from "@/lib/dates";
import { formatBRL, safePercent } from "@/lib/money";
import {
  getRangeByAccount,
  getRangeByMethod,
  getRangeSeries,
  getRangeSummary,
  listAccounts,
  listCategories,
  listIncomeSources,
  listTransactionsInRange,
} from "@/lib/repo";
import { KIND_LABEL, KIND_TARGET, METHOD_LABEL, type CategoryKind } from "@/lib/types";
import { requirePageUser } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

/** Amplitude máxima do período customizado, em meses (5 anos). */
const MAX_RANGE_MONTHS = 60;

/**
 * Relatórios por período: semana, mês, ano ou intervalo customizado.
 *
 * Substituiu a antiga tela "Lançar", que virou só uma lista depois que o
 * lançamento passou a ser um popup acessível de qualquer tela. O extrato
 * continua aqui embaixo — mas agora dentro do período que você escolher, e
 * não sempre no mês corrente.
 */
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const params = await searchParams;
  const hoje = today();

  // O período vem da URL: dá para voltar pelo navegador e compartilhar o recorte.
  const periodo = params.periodo ?? "mes";
  const dataValida = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

  let start: string;
  let end: string;

  if (periodo === "semana") {
    ({ start, end } = weekBounds(hoje));
  } else if (periodo === "ano") {
    ({ start, end } = yearBounds(Number(hoje.slice(0, 4))));
  } else if (periodo === "custom" && dataValida(params.de) && dataValida(params.ate)) {
    start = params.de!;
    end = params.ate!;
    // Intervalo invertido viraria consulta vazia sem explicação: corrige na entrada.
    if (start > end) [start, end] = [end, start];
    /*
     * Teto de amplitude. Só o FORMATO da data era validado, então "0001-01-01"
     * a "9999-12-31" passava — e `getRangeSeries` monta uma chave por mês do
     * intervalo, com trabalho proporcional à distância entre as duas datas. Uma
     * URL montada à mão travava a renderização da página. Cinco anos cobre
     * qualquer recorte que um app de finanças pessoais precise mostrar.
     */
    const limite = addMonthsToDate(start, MAX_RANGE_MONTHS);
    if (end > limite) end = limite;
  } else {
    ({ start, end } = monthBounds(currentMonth()));
  }

  const resumo = getRangeSummary(start, end);
  const serie = getRangeSeries(start, end);
  const porMetodo = getRangeByMethod(start, end);
  const porConta = getRangeByAccount(start, end);
  const lancamentos = listTransactionsInRange(start, end);
  const dias = daysInRange(start, end);

  const categoryData = resumo.byCategory.map((c) => ({
    name: c.category.name,
    cents: c.totalCents,
    color: c.category.color,
    share: c.share,
  }));

  // Média diária: é o número que dá para projetar o resto do período e
  // comparar recortes de tamanhos diferentes (uma semana com um ano).
  const mediaDiaria = dias > 0 ? Math.round(resumo.expenseCents / dias) : 0;

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={`${formatRange(start, end)} · ${dias} ${dias === 1 ? "dia" : "dias"}`}
        actions={
          <EntryDialog
            categories={listCategories()}
            accounts={listAccounts()}
            incomeSources={listIncomeSources()}
            today={hoje}
          />
        }
      />

      <PeriodPicker periodo={periodo} de={start} ate={end} />

      <div className="grid gap-xl sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entradas" cents={resumo.incomeCents} tone="positive" direction="in" />
        <StatCard label="Saídas" cents={resumo.expenseCents} tone="negative" direction="out" />
        <StatCard
          label="Saldo do período"
          cents={resumo.balanceCents}
          tone="auto"
          hint={`${resumo.transactionCount} ${resumo.transactionCount === 1 ? "lançamento" : "lançamentos"}`}
        />
        <StatCard
          label="Média por dia"
          cents={mediaDiaria}
          tone="negative"
          hint="Gasto médio diário no período"
        />
      </div>

      {resumo.transactionCount === 0 ? (
        <div className="mt-xl">
          <Card>
            <EmptyState title="Nenhum lançamento neste período">
              Escolha outro período acima ou registre um lançamento para começar a ver
              os números aqui.
            </EmptyState>
          </Card>
        </div>
      ) : (
        <>
          <div className="mt-xl grid gap-xl lg:grid-cols-2">
            {categoryData.length > 0 ? (
              <CategoryBarChart data={categoryData} />
            ) : (
              <Card>
                <CardTitle>Gastos por categoria</CardTitle>
                <EmptyState title="Sem saídas no período" />
              </Card>
            )}

            <TrendChart
              titulo={serie.bucket === "dia" ? "Dia a dia" : "Mês a mês"}
              dica={
                serie.bucket === "dia"
                  ? "Entradas e saídas por dia"
                  : "Entradas e saídas por mês"
              }
              data={serie.pontos}
            />
          </div>

          <div className="mt-xl grid gap-xl lg:grid-cols-3">
            <Card>
              <CardTitle hint="regra 50/30/20">Divisão dos gastos</CardTitle>
              <ul className="flex flex-col gap-xl">
                {(["NEED", "WANT", "SAVE"] as CategoryKind[]).map((kind) => {
                  const cents = resumo.byKind[kind];
                  const pct = safePercent(
                    cents,
                    resumo.incomeCents || resumo.expenseCents,
                  );
                  const alvo = KIND_TARGET[kind];
                  const fora = kind === "SAVE" ? pct < alvo : pct > alvo;

                  return (
                    <li key={kind}>
                      <div className="mb-md flex items-baseline justify-between gap-md">
                        <span className="text-sm">
                          {KIND_LABEL[kind]}{" "}
                          <span className="text-xs text-muted-foreground">
                            (meta {alvo}%)
                          </span>
                        </span>
                        <span className="flex items-baseline gap-md">
                          <Money cents={cents} size="sm" />
                          <Badge tone={fora ? "warning" : "positive"}>
                            {pct.toFixed(0)}%
                          </Badge>
                        </span>
                      </div>
                      <ProgressBar
                        value={pct}
                        max={100}
                        label={`${KIND_LABEL[kind]}: ${pct.toFixed(0)}%`}
                        tone={fora ? "warning" : "positive"}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card>
              <CardTitle>Por forma de pagamento</CardTitle>
              {porMetodo.length === 0 ? (
                <EmptyState title="Sem saídas no período" />
              ) : (
                <ul className="flex flex-col gap-lg">
                  {porMetodo.map((m) => (
                    <li key={m.method ?? "sem"}>
                      <div className="mb-sm flex items-baseline justify-between gap-md">
                        <span className="text-sm">
                          {m.method ? METHOD_LABEL[m.method] : "Não informado"}
                        </span>
                        <Money cents={m.totalCents} size="sm" />
                      </div>
                      <ProgressBar
                        value={m.totalCents}
                        max={resumo.expenseCents || 1}
                        label={`${m.method ? METHOD_LABEL[m.method] : "Não informado"}: ${formatBRL(m.totalCents)}`}
                        tone="neutral"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle>Por conta e cartão</CardTitle>
              {porConta.length === 0 ? (
                <EmptyState title="Sem saídas no período" />
              ) : (
                <ul className="flex flex-col gap-lg">
                  {porConta.map((c, i) => (
                    <li key={c.name ?? `sem-${i}`}>
                      <div className="mb-sm flex items-baseline justify-between gap-md">
                        <span className="flex items-center gap-md text-sm">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: c.color ?? "var(--color-muted-foreground)",
                            }}
                          />
                          {c.name ?? "Sem conta"}
                        </span>
                        <Money cents={c.totalCents} size="sm" />
                      </div>
                      <ProgressBar
                        value={c.totalCents}
                        max={resumo.expenseCents || 1}
                        label={`${c.name ?? "Sem conta"}: ${formatBRL(c.totalCents)}`}
                        tone="neutral"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {resumo.byIncomeSource.length > 0 ? (
            <div className="mt-xl">
              <Card>
                <CardTitle hint="de onde veio a renda">Renda por empresa</CardTitle>
                <ul className="flex flex-col gap-lg">
                  {resumo.byIncomeSource.map((s) => (
                    <li key={s.source.id}>
                      <div className="mb-sm flex items-baseline justify-between gap-md">
                        <span className="flex items-center gap-md text-sm">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: s.source.color }}
                          />
                          {s.source.name}
                        </span>
                        <span className="flex items-baseline gap-md">
                          <Money cents={s.totalCents} size="sm" tone="positive" />
                          <span className="w-12 text-right text-xs text-muted-foreground">
                            {s.share.toFixed(0)}%
                          </span>
                        </span>
                      </div>
                      <ProgressBar
                        value={s.share}
                        max={100}
                        label={`${s.source.name}: ${s.share.toFixed(0)}% da renda`}
                        tone="positive"
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null}

          <div className="mt-xl">
            <TransactionList transactions={lancamentos} month={start.slice(0, 7)} />
          </div>
        </>
      )}
    </>
  );
}

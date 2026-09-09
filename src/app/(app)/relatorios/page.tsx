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

/** Amplitude mÃ¡xima do perÃ­odo customizado, em meses (5 anos). */
const MAX_RANGE_MONTHS = 60;

/**
 * RelatÃ³rios por perÃ­odo: semana, mÃªs, ano ou intervalo customizado.
 *
 * Substituiu a antiga tela "LanÃ§ar", que virou sÃ³ uma lista depois que o
 * lanÃ§amento passou a ser um popup acessÃ­vel de qualquer tela. O extrato
 * continua aqui embaixo â€” mas agora dentro do perÃ­odo que vocÃª escolher, e
 * nÃ£o sempre no mÃªs corrente.
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

  // O perÃ­odo vem da URL: dÃ¡ para voltar pelo navegador e compartilhar o recorte.
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
    // Intervalo invertido viraria consulta vazia sem explicaÃ§Ã£o: corrige na entrada.
    if (start > end) [start, end] = [end, start];
    /*
     * Teto de amplitude. SÃ³ o FORMATO da data era validado, entÃ£o "0001-01-01"
     * a "9999-12-31" passava â€” e `getRangeSeries` monta uma chave por mÃªs do
     * intervalo, com trabalho proporcional Ã  distÃ¢ncia entre as duas datas. Uma
     * URL montada Ã  mÃ£o travava a renderizaÃ§Ã£o da pÃ¡gina. Cinco anos cobre
     * qualquer recorte que um app de finanÃ§as pessoais precise mostrar.
     */
    const limite = addMonthsToDate(start, MAX_RANGE_MONTHS);
    if (end > limite) end = limite;
  } else {
    ({ start, end } = monthBounds(currentMonth()));
  }

  const resumo = await getRangeSummary(start, end);
  const serie = await getRangeSeries(start, end);
  const porMetodo = await getRangeByMethod(start, end);
  const porConta = await getRangeByAccount(start, end);
  const lancamentos = await listTransactionsInRange(start, end);
  const dias = daysInRange(start, end);

  const categoryData = resumo.byCategory.map((c) => ({
    name: c.category.name,
    cents: c.totalCents,
    color: c.category.color,
    share: c.share,
  }));

  // MÃ©dia diÃ¡ria: Ã© o nÃºmero que dÃ¡ para projetar o resto do perÃ­odo e
  // comparar recortes de tamanhos diferentes (uma semana com um ano).
  const mediaDiaria = dias > 0 ? Math.round(resumo.expenseCents / dias) : 0;

  return (
    <>
      <PageHeader
        title="RelatÃ³rios"
        subtitle={`${formatRange(start, end)} Â· ${dias} ${dias === 1 ? "dia" : "dias"}`}
        actions={
          <EntryDialog
            categories={await listCategories()}
            accounts={await listAccounts()}
            incomeSources={await listIncomeSources()}
            today={hoje}
          />
        }
      />

      <PeriodPicker periodo={periodo} de={start} ate={end} />

      <div className="grid gap-xl sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entradas" cents={resumo.incomeCents} tone="positive" direction="in" />
        <StatCard label="SaÃ­das" cents={resumo.expenseCents} tone="negative" direction="out" />
        <StatCard
          label="Saldo do perÃ­odo"
          cents={resumo.balanceCents}
          tone="auto"
          hint={`${resumo.transactionCount} ${resumo.transactionCount === 1 ? "lanÃ§amento" : "lanÃ§amentos"}`}
        />
        <StatCard
          label="MÃ©dia por dia"
          cents={mediaDiaria}
          tone="negative"
          hint="Gasto mÃ©dio diÃ¡rio no perÃ­odo"
        />
      </div>

      {resumo.transactionCount === 0 ? (
        <div className="mt-xl">
          <Card>
            <EmptyState title="Nenhum lanÃ§amento neste perÃ­odo">
              Escolha outro perÃ­odo acima ou registre um lanÃ§amento para comeÃ§ar a ver
              os nÃºmeros aqui.
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
                <EmptyState title="Sem saÃ­das no perÃ­odo" />
              </Card>
            )}

            <TrendChart
              titulo={serie.bucket === "dia" ? "Dia a dia" : "MÃªs a mÃªs"}
              dica={
                serie.bucket === "dia"
                  ? "Entradas e saÃ­das por dia"
                  : "Entradas e saÃ­das por mÃªs"
              }
              data={serie.pontos}
            />
          </div>

          <div className="mt-xl grid gap-xl lg:grid-cols-3">
            <Card>
              <CardTitle hint="regra 50/30/20">DivisÃ£o dos gastos</CardTitle>
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
                <EmptyState title="Sem saÃ­das no perÃ­odo" />
              ) : (
                <ul className="flex flex-col gap-lg">
                  {porMetodo.map((m) => (
                    <li key={m.method ?? "sem"}>
                      <div className="mb-sm flex items-baseline justify-between gap-md">
                        <span className="text-sm">
                          {m.method ? METHOD_LABEL[m.method] : "NÃ£o informado"}
                        </span>
                        <Money cents={m.totalCents} size="sm" />
                      </div>
                      <ProgressBar
                        value={m.totalCents}
                        max={resumo.expenseCents || 1}
                        label={`${m.method ? METHOD_LABEL[m.method] : "NÃ£o informado"}: ${formatBRL(m.totalCents)}`}
                        tone="neutral"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle>Por conta e cartÃ£o</CardTitle>
              {porConta.length === 0 ? (
                <EmptyState title="Sem saÃ­das no perÃ­odo" />
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
            <TransactionList
              transactions={lancamentos}
              month={start.slice(0, 7)}
              allCategories={await listCategories()}
              accounts={await listAccounts()}
              incomeSources={await listIncomeSources()}
            />
          </div>
        </>
      )}
    </>
  );
}


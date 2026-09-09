import { CategoryBarChart, TrendChart } from "@/components/charts";
import { EntryDialog } from "@/components/entry-dialog";
import { PeriodPicker } from "@/components/period-picker";
import { ReportFilters } from "@/components/report-filters";
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
  addDays,
  addMonths,
  addMonthsToDate,
  currentMonth,
  daysInRange,
  formatDayMonth,
  formatMonth,
  formatRange,
  monthBounds,
  today,
  weekBounds,
  yearBounds,
} from "@/lib/dates";
import { formatBRL, safePercent } from "@/lib/money";
import {
  listAccounts,
  listCategories,
  listIncomeSources,
  listTransactionsInRange,
} from "@/lib/repo";
import {
  KIND_LABEL,
  KIND_TARGET,
  METHOD_LABEL,
  NATURE_LABEL,
  type Account,
  type Category,
  type CategoryKind,
  type IncomeSource,
  type PaymentMethod,
  type TransactionWithCategory,
  type TxNature,
  type TxType,
} from "@/lib/types";
import { requirePageUser } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

/** Amplitude máxima do período customizado, em meses (5 anos). */
const MAX_RANGE_MONTHS = 60;

type ReportSummary = {
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  byKind: Record<CategoryKind, number>;
  byCategory: Array<{
    category: Category;
    totalCents: number;
    share: number;
    budgetCents: number | null;
    budgetUsedPct: number | null;
  }>;
  transactionCount: number;
  byIncomeSource: Array<{
    source: IncomeSource;
    totalCents: number;
    share: number;
  }>;
  installmentCents: number;
  fixedCents: number;
};

type ReportSeries = {
  bucket: "dia" | "mes";
  pontos: Array<{
    label: string;
    incomeCents: number;
    expenseCents: number;
    balanceCents: number;
  }>;
};

function sumTransactions(transactions: TransactionWithCategory[], type: TxType): number {
  return transactions.reduce(
    (total, transaction) =>
      total + (transaction.type === type ? transaction.amountCents : 0),
    0,
  );
}

function buildReportSummary(
  transactions: TransactionWithCategory[],
  incomeSources: IncomeSource[],
): ReportSummary {
  const incomeCents = sumTransactions(transactions, "INCOME");
  const expenseCents = sumTransactions(transactions, "EXPENSE");
  const byCategoryMap = new Map<string, { category: Category; totalCents: number }>();
  const bySourceMap = new Map<string, { source: IncomeSource; totalCents: number }>();
  const byKind: Record<CategoryKind, number> = { NEED: 0, WANT: 0, SAVE: 0 };
  let installmentCents = 0;
  let fixedCents = 0;

  for (const transaction of transactions) {
    if (transaction.type === "EXPENSE") {
      const current = byCategoryMap.get(transaction.category.id);
      byCategoryMap.set(transaction.category.id, {
        category: transaction.category,
        totalCents: (current?.totalCents ?? 0) + transaction.amountCents,
      });
      byKind[transaction.category.kind] += transaction.amountCents;
      if (transaction.nature === "PARCELADO") installmentCents += transaction.amountCents;
      if (transaction.nature === "FIXO") fixedCents += transaction.amountCents;
    }

    if (transaction.type === "INCOME" && transaction.incomeSourceId) {
      const source = incomeSources.find((item) => item.id === transaction.incomeSourceId);
      if (source) {
        const current = bySourceMap.get(source.id);
        bySourceMap.set(source.id, {
          source,
          totalCents: (current?.totalCents ?? 0) + transaction.amountCents,
        });
      }
    }
  }

  const byCategory = [...byCategoryMap.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map(({ category, totalCents }) => ({
      category,
      totalCents,
      share: safePercent(totalCents, expenseCents),
      budgetCents: category.budgetCents,
      budgetUsedPct:
        category.budgetCents && category.budgetCents > 0
          ? safePercent(totalCents, category.budgetCents)
          : null,
    }));

  const byIncomeSource = [...bySourceMap.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map(({ source, totalCents }) => ({
      source,
      totalCents,
      share: safePercent(totalCents, incomeCents),
    }));

  return {
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    byKind,
    byCategory,
    transactionCount: transactions.length,
    byIncomeSource,
    installmentCents,
    fixedCents,
  };
}

function buildReportSeries(
  start: string,
  end: string,
  transactions: TransactionWithCategory[],
): ReportSeries {
  const bucket: "dia" | "mes" = daysInRange(start, end) <= 62 ? "dia" : "mes";
  const keys: string[] = [];

  if (bucket === "dia") {
    for (let date = start; date <= end; date = addDays(date, 1)) keys.push(date);
  } else {
    for (let month = start.slice(0, 7); month <= end.slice(0, 7); month = addMonths(month, 1)) {
      keys.push(month);
    }
  }

  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const key = bucket === "dia" ? transaction.date : transaction.date.slice(0, 7);
    const totalKey = `${key}:${transaction.type}`;
    totals.set(totalKey, (totals.get(totalKey) ?? 0) + transaction.amountCents);
  }

  return {
    bucket,
    pontos: keys.map((key) => {
      const incomeCents = totals.get(`${key}:INCOME`) ?? 0;
      const expenseCents = totals.get(`${key}:EXPENSE`) ?? 0;
      return {
        label: bucket === "dia" ? formatDayMonth(key) : formatMonth(key),
        incomeCents,
        expenseCents,
        balanceCents: incomeCents - expenseCents,
      };
    }),
  };
}

function buildMethodTotals(transactions: TransactionWithCategory[]) {
  const totals = new Map<PaymentMethod | null, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    totals.set(transaction.method, (totals.get(transaction.method) ?? 0) + transaction.amountCents);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, totalCents]) => ({ method, totalCents }));
}

function buildAccountTotals(transactions: TransactionWithCategory[], accounts: Account[]) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const totals = new Map<string, { name: string | null; color: string | null; totalCents: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    const account = transaction.accountId ? accountById.get(transaction.accountId) : undefined;
    const key = transaction.accountId ?? "sem-conta";
    const current = totals.get(key);
    totals.set(key, {
      name: account?.name ?? transaction.accountName,
      color: account?.color ?? null,
      totalCents: (current?.totalCents ?? 0) + transaction.amountCents,
    });
  }

  return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents);
}

function isPaymentMethod(value: string | undefined): value is PaymentMethod {
  return !!value && value in METHOD_LABEL;
}

function isTxNature(value: string | undefined): value is TxNature {
  return !!value && value in NATURE_LABEL;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

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
  searchParams: Promise<{
    periodo?: string;
    de?: string;
    ate?: string;
    tipo?: string;
    categoria?: string;
    conta?: string;
    metodo?: string;
    natureza?: string;
    fonte?: string;
    busca?: string;
  }>;
}) {
  // Autorização por página: o layout não impede o segmento de rodar.
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

  const [todasCategorias, todasContas, todasFontes, todosLancamentos] = await Promise.all([
    listCategories(true),
    listAccounts(true),
    listIncomeSources(true),
    listTransactionsInRange(start, end),
  ]);
  const categorias = todasCategorias.filter((category) => !category.archived);
  const contas = todasContas.filter((account) => !account.archived);
  const fontes = todasFontes.filter((source) => !source.archived);

  const tipo: TxType | "" = params.tipo === "INCOME" || params.tipo === "EXPENSE" ? params.tipo : "";
  const metodo: PaymentMethod | "" = isPaymentMethod(params.metodo) ? params.metodo : "";
  const natureza: TxNature | "" = isTxNature(params.natureza) ? params.natureza : "";
  const busca = normalizeSearchText(params.busca?.trim() ?? "");

  const lancamentos = todosLancamentos.filter((transaction) => {
    // Transferências próprias mudam o dinheiro de lugar, mas não representam
    // entrada ou saída no relatório e já ficam fora dos indicadores.
    if (transaction.transferToAccountId) return false;
    if (tipo && transaction.type !== tipo) return false;
    if (params.categoria && transaction.categoryId !== params.categoria) return false;
    if (params.conta && transaction.accountId !== params.conta) return false;
    if (metodo && transaction.method !== metodo) return false;
    if (natureza && transaction.nature !== natureza) return false;
    if (params.fonte && transaction.incomeSourceId !== params.fonte) return false;
    if (busca) {
      const texto = normalizeSearchText([
        transaction.description,
        transaction.notes,
        transaction.category.name,
        transaction.accountName,
        transaction.incomeSourceName,
      ]
        .filter(Boolean)
        .join(" "));
      if (!texto.includes(busca)) return false;
    }
    return true;
  });

  const resumo = buildReportSummary(lancamentos, todasFontes);
  const serie = buildReportSeries(start, end, lancamentos);
  const porMetodo = buildMethodTotals(lancamentos);
  const porConta = buildAccountTotals(lancamentos, contas);
  const dias = daysInRange(start, end);

  const categoryData = resumo.byCategory.map((c) => ({
    name: c.category.name,
    cents: c.totalCents,
    color: c.category.color,
    share: c.share,
  }));

  // Média diária: é o número que dá para projetar o resto do período e
  // comparar recortes de tamanhos diferentes (uma semana com um ano).
  const mediaBase = tipo === "INCOME" ? resumo.incomeCents : resumo.expenseCents;
  const mediaDiaria = dias > 0 ? Math.round(mediaBase / dias) : 0;
  const mediaLabel = tipo === "INCOME" ? "Média de entradas por dia" : "Média por dia";
  const mediaHint =
    tipo === "INCOME" ? "Entrada média diária no período" : "Gasto médio diário no período";

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={`${formatRange(start, end)} · ${dias} ${dias === 1 ? "dia" : "dias"}`}
        actions={
          <EntryDialog
            categories={categorias}
            accounts={contas}
            incomeSources={fontes}
            today={hoje}
          />
        }
      />

      <PeriodPicker de={start} ate={end} />

      <ReportFilters
        key={`${tipo}|${params.categoria ?? ""}|${params.conta ?? ""}|${metodo}|${natureza}|${params.fonte ?? ""}|${params.busca ?? ""}`}
        categories={todasCategorias}
        accounts={todasContas}
        incomeSources={todasFontes}
        values={{
          tipo,
          categoria: params.categoria ?? "",
          conta: params.conta ?? "",
          metodo,
          natureza,
          fonte: params.fonte ?? "",
          busca: params.busca ?? "",
        }}
      />

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
          label={mediaLabel}
          cents={mediaDiaria}
          tone={tipo === "INCOME" ? "positive" : "negative"}
          hint={mediaHint}
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
            <TransactionList
              transactions={lancamentos}
              month={start.slice(0, 7)}
              periodLabel={formatRange(start, end)}
              allCategories={todasCategorias}
              accounts={todasContas}
              incomeSources={todasFontes}
            />
          </div>
        </>
      )}
    </>
  );
}


import "server-only";

import { getDb, newId } from "./db";
import {
  addMonthsToDate,
  firstInvoiceDueDate,
  monthBounds,
  monthRange,
  today,
} from "./dates";
import { safePercent, splitCents } from "./money";
import type {
  Account,
  AccountKind,
  AccountWithBalance,
  Bill,
  BillInMonth,
  BillStatus,
  Category,
  CategoryKind,
  CategoryTotal,
  Goal,
  IncomeKind,
  IncomeSource,
  IncomeSourceTotal,
  MonthSummary,
  PaymentMethod,
  Recurrence,
  Scenario,
  Transaction,
  TransactionWithCategory,
  TxNature,
  TxType,
} from "./types";

/**
 * Acesso a dados. Tudo síncrono porque `node:sqlite` é síncrono e o banco é um
 * arquivo local — não há round-trip de rede para justificar async.
 *
 * SQLite guarda boolean como 0/1: as funções `row*` abaixo são o único lugar
 * que traduz isso para `boolean`. Nenhum componente lida com 0/1.
 */

interface CategoryRow {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetCents: number | null;
  archived: number;
}

function rowToCategory(r: CategoryRow): Category {
  return { ...r, archived: r.archived === 1 };
}

interface TxRow {
  id: string;
  type: TxType;
  amountCents: number;
  date: string;
  description: string;
  nature: TxNature;
  notes: string | null;
  categoryId: string;
  method: PaymentMethod | null;
  purchaseId: string | null;
  installmentNo: number | null;
  installmentTotal: number | null;
  accountId: string | null;
  incomeSourceId: string | null;
  purchaseDate: string | null;
}

function rowToTransaction(r: TxRow): Transaction {
  return { ...r };
}

/** Colunas do lançamento + o JOIN das entidades exibidas junto. */
const TX_SELECT = `
  t.id, t.type, t.amountCents, t.date, t.description, t.nature, t.notes,
  t.categoryId, t.purchaseId, t.installmentNo, t.installmentTotal,
  t.accountId, t.incomeSourceId, t.purchaseDate, t.method,
  c.name AS c_name, c.kind AS c_kind, c.color AS c_color,
  c.icon AS c_icon, c.budgetCents AS c_budget, c.archived AS c_archived,
  a.name AS a_name, s.name AS s_name`;

const TX_FROM = `
  FROM transactions t
  JOIN categories c ON c.id = t.categoryId
  LEFT JOIN accounts a ON a.id = t.accountId
  LEFT JOIN income_sources s ON s.id = t.incomeSourceId`;

type TxJoinRow = TxRow & {
  c_name: string;
  c_kind: CategoryKind;
  c_color: string;
  c_icon: string;
  c_budget: number | null;
  c_archived: number;
  a_name: string | null;
  s_name: string | null;
};

function rowToTransactionWithCategory(r: TxJoinRow): TransactionWithCategory {
  return {
    ...rowToTransaction(r),
    category: {
      id: r.categoryId,
      name: r.c_name,
      kind: r.c_kind,
      color: r.c_color,
      icon: r.c_icon,
      budgetCents: r.c_budget,
      archived: r.c_archived === 1,
    },
    accountName: r.a_name,
    incomeSourceName: r.s_name,
  };
}

// ---------------------------------------------------------------- categorias

export function listCategories(includeArchived = false): Category[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, kind, color, icon, budgetCents, archived
         FROM categories
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all(includeArchived ? 1 : 0) as unknown as CategoryRow[];
  return rows.map(rowToCategory);
}

export function createCategory(input: {
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetCents: number | null;
}): string {
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO categories (id, name, kind, color, icon, budgetCents)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.kind, input.color, input.icon, input.budgetCents);
  return id;
}

export function updateCategoryBudget(id: string, budgetCents: number | null): void {
  getDb()
    .prepare(`UPDATE categories SET budgetCents = ? WHERE id = ?`)
    .run(budgetCents, id);
}

// --------------------------------------------------------------- lançamentos

export function listTransactions(opts: {
  month?: string;
  categoryId?: string;
  limit?: number;
}): TransactionWithCategory[] {
  const db = getDb();
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (opts.month) {
    const { start, end } = monthBounds(opts.month);
    where.push("t.date BETWEEN ? AND ?");
    params.push(start, end);
  }
  if (opts.categoryId) {
    where.push("t.categoryId = ?");
    params.push(opts.categoryId);
  }

  const sql = `
    SELECT ${TX_SELECT}
    ${TX_FROM}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY t.date DESC, t.createdAt DESC
     ${opts.limit ? "LIMIT ?" : ""}`;

  if (opts.limit) params.push(opts.limit);

  // JOIN em vez de buscar categoria por lançamento: uma consulta em vez de N+1.
  const rows = db.prepare(sql).all(...params) as unknown as TxJoinRow[];
  return rows.map(rowToTransactionWithCategory);
}

export interface NewTransaction {
  type: TxType;
  /**
   * Em FIXO e VISTA: o valor do lançamento.
   * Em PARCELADO: o valor TOTAL da compra, que será dividido em `installments`.
   */
  amountCents: number;
  date: string;
  description: string;
  categoryId: string;
  nature: TxNature;
  /** Número de parcelas. Só usado quando nature === "PARCELADO". */
  installments?: number;
  accountId: string | null;
  incomeSourceId: string | null;
  method: PaymentMethod | null;
  notes: string | null;
}

const INSERT_TX = `
  INSERT INTO transactions
    (id, type, amountCents, date, description, nature, notes, categoryId,
     purchaseId, installmentNo, installmentTotal, accountId, incomeSourceId,
     purchaseDate, method)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Quando o dinheiro realmente sai, e qual foi o dia da compra.
 *
 * Em carteira comum, os dois são a mesma data. No cartão de crédito não são: a
 * compra é hoje, o dinheiro sai no vencimento da fatura em que ela caiu. Tratar
 * os dois como a mesma coisa adiantaria o gasto em até dois meses no fluxo de
 * caixa — que é justamente o erro que faz alguém achar que o mês fechou bem.
 */
function resolveCashOutDate(
  purchaseDate: string,
  account: Account | null,
): { date: string; purchaseDate: string | null } {
  if (
    !account ||
    account.kind !== "CARTAO" ||
    account.closingDay === null ||
    account.dueDay === null
  ) {
    return { date: purchaseDate, purchaseDate: null };
  }

  return {
    date: firstInvoiceDueDate(purchaseDate, account.closingDay, account.dueDay),
    purchaseDate,
  };
}

export function getAccount(id: string): Account | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, kind, openingCents, closingDay, dueDay, last4,
              creditLimitCents, overdraftLimitCents, bankIspb, bankName, logoUrl,
              color, archived
         FROM accounts WHERE id = ?`,
    )
    .get(id) as unknown as AccountRow | undefined;
  return row ? { ...row, archived: row.archived === 1 } : null;
}

/**
 * Cria o lançamento. Em PARCELADO, cria UMA LINHA POR PARCELA, uma por mês.
 *
 * Por que não guardar uma linha só com o total e calcular as parcelas na
 * leitura: porque o fechamento de cada mês precisa somar o que realmente saiu
 * naquele mês. Compra de R$ 1.200 em 6x lançada inteira em setembro faria
 * setembro parecer catastrófico e outubro a fevereiro parecerem livres — e o
 * orçamento por categoria, o alerta de estouro e a sobra média sairiam todos
 * errados. Cada parcela existe como fato do seu próprio mês.
 *
 * Retorna o id da primeira linha criada.
 */
export function createTransaction(input: NewTransaction): string {
  const db = getDb();
  const insert = db.prepare(INSERT_TX);

  // Entrada nunca passa pelo ciclo de fatura — salário não cai em fatura.
  const account =
    input.type === "EXPENSE" && input.accountId ? getAccount(input.accountId) : null;
  const { date: firstDate, purchaseDate } = resolveCashOutDate(input.date, account);

  if (input.nature !== "PARCELADO") {
    const id = newId();
    insert.run(
      id,
      input.type,
      input.amountCents,
      firstDate,
      input.description,
      input.nature,
      input.notes,
      input.categoryId,
      null,
      null,
      null,
      input.accountId,
      input.incomeSourceId,
      purchaseDate,
      // Compra no cartão de crédito é crédito por definição — não faz sentido
      // deixar o usuário escolher "pix" numa carteira do tipo CARTAO.
      account?.kind === "CARTAO" ? "CREDITO" : input.method,
    );
    return id;
  }

  const parts = Math.max(1, Math.floor(input.installments ?? 1));
  // Divisão que não perde centavo — ver splitCents em money.ts.
  const values = splitCents(input.amountCents, parts);
  const purchaseId = newId();
  let firstId = "";

  // Transação do SQLite: ou todas as parcelas entram, ou nenhuma. Uma compra
  // gravada pela metade seria pior que uma compra não gravada.
  db.exec("BEGIN");
  try {
    values.forEach((cents, i) => {
      const id = newId();
      if (i === 0) firstId = id;
      insert.run(
        id,
        input.type,
        cents,
        // A 1ª parcela cai na fatura resolvida acima; as seguintes, um mês
        // depois de cada anterior.
        addMonthsToDate(firstDate, i),
        input.description,
        "PARCELADO",
        input.notes,
        input.categoryId,
        purchaseId,
        i + 1,
        parts,
        input.accountId,
        input.incomeSourceId,
        purchaseDate,
        account?.kind === "CARTAO" ? "CREDITO" : input.method,
      );
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return firstId;
}

/** Apaga uma compra parcelada inteira (todas as parcelas de uma vez). */
export function deletePurchase(purchaseId: string): void {
  getDb().prepare(`DELETE FROM transactions WHERE purchaseId = ?`).run(purchaseId);
}

export function deleteTransaction(id: string): void {
  getDb().prepare(`DELETE FROM transactions WHERE id = ?`).run(id);
}

// -------------------------------------------------------------------- resumo

/**
 * Resumo de um mês. Uma única passada de agregação no SQL, depois o cálculo de
 * participação/orçamento em memória (é dezena de categorias, não milhão de linhas).
 */
export function getMonthSummary(month: string): MonthSummary {
  const db = getDb();
  const { start, end } = monthBounds(month);

  // `transferToAccountId IS NULL` em toda agregação de mês: transferência entre
  // contas próprias não é receita nem despesa, é o mesmo dinheiro mudando de
  // lugar. Contá-la inflaria o total do mês e faria a regra 50/30/20 mentir.
  const totals = db
    .prepare(
      `SELECT type, SUM(amountCents) AS total, COUNT(*) AS n
         FROM transactions
        WHERE date BETWEEN ? AND ? AND transferToAccountId IS NULL
        GROUP BY type`,
    )
    .all(start, end) as unknown as Array<{
    type: TxType;
    total: number;
    n: number;
  }>;

  const incomeCents = totals.find((t) => t.type === "INCOME")?.total ?? 0;
  const expenseCents = totals.find((t) => t.type === "EXPENSE")?.total ?? 0;
  const transactionCount = totals.reduce((acc, t) => acc + t.n, 0);

  const perCategory = db
    .prepare(
      `SELECT c.id, c.name, c.kind, c.color, c.icon, c.budgetCents, c.archived,
              SUM(t.amountCents) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.categoryId
        WHERE t.date BETWEEN ? AND ? AND t.type = 'EXPENSE'
          AND t.transferToAccountId IS NULL
        GROUP BY c.id
        ORDER BY total DESC`,
    )
    .all(start, end) as unknown as Array<CategoryRow & { total: number }>;

  const byCategory: CategoryTotal[] = perCategory.map((r) => ({
    category: rowToCategory(r),
    totalCents: r.total,
    share: safePercent(r.total, expenseCents),
    budgetCents: r.budgetCents,
    budgetUsedPct:
      r.budgetCents && r.budgetCents > 0
        ? safePercent(r.total, r.budgetCents)
        : null,
  }));

  const byKind: Record<CategoryKind, number> = { NEED: 0, WANT: 0, SAVE: 0 };
  for (const c of byCategory) byKind[c.category.kind] += c.totalCents;

  // Renda por fonte: é o que separa a parte previsível (CLT) da variável (PJ).
  const incomeRows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.color, s.archived, SUM(t.amountCents) AS total
         FROM transactions t
         JOIN income_sources s ON s.id = t.incomeSourceId
        WHERE t.date BETWEEN ? AND ? AND t.type = 'INCOME'
          AND t.transferToAccountId IS NULL
        GROUP BY s.id
        ORDER BY total DESC`,
    )
    .all(start, end) as unknown as Array<{
    id: string;
    name: string;
    kind: IncomeKind;
    color: string;
    archived: number;
    total: number;
  }>;

  const byIncomeSource: IncomeSourceTotal[] = incomeRows.map((r) => ({
    source: {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      archived: r.archived === 1,
    },
    totalCents: r.total,
    share: safePercent(r.total, incomeCents),
  }));

  // Quanto do mês é compromisso herdado (parcela) e quanto é custo fixo.
  const natureRows = db
    .prepare(
      `SELECT nature, SUM(amountCents) AS total
         FROM transactions
        WHERE date BETWEEN ? AND ? AND type = 'EXPENSE'
          AND transferToAccountId IS NULL
        GROUP BY nature`,
    )
    .all(start, end) as unknown as Array<{ nature: TxNature; total: number }>;

  const installmentCents =
    natureRows.find((r) => r.nature === "PARCELADO")?.total ?? 0;
  const fixedCents = natureRows.find((r) => r.nature === "FIXO")?.total ?? 0;

  return {
    month,
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    byKind,
    byCategory,
    transactionCount,
    byIncomeSource,
    installmentCents,
    fixedCents,
  };
}

/** Série mensal para o gráfico de evolução. Meses sem lançamento viram zero. */
export function getMonthlySeries(endMonth: string, count: number) {
  const db = getDb();
  const months = monthRange(endMonth, count);
  const { start } = monthBounds(months[0]);
  const { end } = monthBounds(endMonth);

  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, type, SUM(amountCents) AS total
         FROM transactions
        WHERE date BETWEEN ? AND ?
        GROUP BY month, type`,
    )
    .all(start, end) as unknown as Array<{
    month: string;
    type: TxType;
    total: number;
  }>;

  // Preenche o eixo com todos os meses: um buraco no meio da linha leria como
  // "sem dado" quando na verdade significa "nada gasto".
  return months.map((month) => {
    const income = rows.find((r) => r.month === month && r.type === "INCOME");
    const expense = rows.find((r) => r.month === month && r.type === "EXPENSE");
    const incomeCents = income?.total ?? 0;
    const expenseCents = expense?.total ?? 0;
    return {
      month,
      incomeCents,
      expenseCents,
      balanceCents: incomeCents - expenseCents,
    };
  });
}

/**
 * Sobra média dos últimos N meses fechados (exclui o mês corrente, que ainda
 * está incompleto e daria uma sobra otimista demais). É o número que vira o
 * aporte sugerido na projeção de investimento.
 */
export function getAverageSurplus(endMonth: string, count = 3): number {
  const series = getMonthlySeries(endMonth, count + 1).slice(0, count);
  const withData = series.filter((s) => s.incomeCents > 0 || s.expenseCents > 0);
  if (withData.length === 0) return 0;
  const sum = withData.reduce((acc, s) => acc + s.balanceCents, 0);
  return Math.round(sum / withData.length);
}

/**
 * Tudo que já foi para categorias do tipo "poupar", desde sempre.
 * É a proxy da reserva de emergência: o app não conecta na corretora, então o
 * que ele sabe sobre o seu patrimônio é o que você registrou como guardado.
 */
export function getTotalSavedAllTime(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(t.amountCents), 0) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.categoryId
        WHERE c.kind = 'SAVE' AND t.type = 'EXPENSE'`,
    )
    .get() as { total: number };
  return row.total;
}

/** Soma mensal dos lançamentos marcados como recorrentes. */
export function getRecurringMonthlyTotal(): number {
  return listRecurring().reduce((acc, t) => acc + t.amountCents, 0);
}

/** Custos fixos distintos — candidatos naturais a corte. */
export function listRecurring(): TransactionWithCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT ${TX_SELECT}
       ${TX_FROM}
        WHERE t.nature = 'FIXO' AND t.type = 'EXPENSE'
        GROUP BY t.description, t.categoryId
        ORDER BY t.amountCents DESC`,
    )
    .all() as unknown as TxJoinRow[];
  return rows.map(rowToTransactionWithCategory);
}

/**
 * Parcelas que ainda vão cair, a partir de amanhã.
 *
 * É o número que responde "quanto do meu futuro já está comprometido?".
 * Uma compra em 12x não dói no mês da compra — dói nos onze meses seguintes,
 * e é justamente por isso que ela some do radar de quem só olha o mês atual.
 */
export function getFutureInstallments(): {
  totalCents: number;
  count: number;
  byMonth: Array<{ month: string; cents: number }>;
} {
  const db = getDb();
  const todayIso = today();

  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(amountCents) AS total, COUNT(*) AS n
         FROM transactions
        WHERE nature = 'PARCELADO' AND type = 'EXPENSE' AND date > ?
        GROUP BY month
        ORDER BY month`,
    )
    .all(todayIso) as unknown as Array<{
    month: string;
    total: number;
    n: number;
  }>;

  return {
    totalCents: rows.reduce((acc, r) => acc + r.total, 0),
    count: rows.reduce((acc, r) => acc + r.n, 0),
    byMonth: rows.map((r) => ({ month: r.month, cents: r.total })),
  };
}

// ------------------------------------------------------------- carteiras

interface AccountRow {
  id: string;
  name: string;
  kind: AccountKind;
  openingCents: number;
  closingDay: number | null;
  dueDay: number | null;
  last4: string | null;
  creditLimitCents: number | null;
  overdraftLimitCents: number | null;
  bankIspb: string | null;
  bankName: string | null;
  logoUrl: string | null;
  color: string;
  archived: number;
}

export function listAccounts(includeArchived = false): Account[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, kind, openingCents, closingDay, dueDay, last4,
              creditLimitCents, overdraftLimitCents, bankIspb, bankName, logoUrl,
              color, archived
         FROM accounts
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all(includeArchived ? 1 : 0) as unknown as AccountRow[];
  return rows.map((r) => ({ ...r, archived: r.archived === 1 }));
}

/**
 * Carteiras com saldo CALCULADO: saldo inicial + entradas − saídas.
 *
 * O saldo nunca é gravado numa coluna. Se fosse, bastaria excluir um
 * lançamento para o saldo guardado divergir do extrato — e não haveria como
 * saber qual dos dois está certo. Calcular sempre custa uma agregação e
 * elimina a classe inteira de bug.
 */
export function listAccountsWithBalance(month: string): AccountWithBalance[] {
  const db = getDb();
  const accounts = listAccounts();
  if (accounts.length === 0) return [];

  const { start, end } = monthBounds(month);

  const totals = db
    .prepare(
      `SELECT accountId, type, SUM(amountCents) AS total
         FROM transactions
        WHERE accountId IS NOT NULL
        GROUP BY accountId, type`,
    )
    .all() as unknown as Array<{
    accountId: string;
    type: TxType;
    total: number;
  }>;

  const monthTotals = db
    .prepare(
      `SELECT accountId, type, SUM(amountCents) AS total
         FROM transactions
        WHERE accountId IS NOT NULL AND date BETWEEN ? AND ?
        GROUP BY accountId, type`,
    )
    .all(start, end) as unknown as Array<{
    accountId: string;
    type: TxType;
    total: number;
  }>;

  const pick = (
    rows: typeof totals,
    accountId: string,
    type: TxType,
  ): number =>
    rows.find((r) => r.accountId === accountId && r.type === type)?.total ?? 0;

  /*
   * O lado que RECEBE a transferência.
   *
   * A linha de transferência é gravada como EXPENSE na conta de origem — a
   * consulta acima já a subtrai de lá. Falta creditar o destino, senão o
   * dinheiro simplesmente evapora: some da conta corrente e não aparece no
   * cartão nem na poupança.
   *
   * No cartão, é isso que zera a fatura: o saldo do cartão é negativo pelas
   * compras, e a transferência entra somando de volta.
   */
  const recebidos = db
    .prepare(
      `SELECT transferToAccountId AS accountId, SUM(amountCents) AS total
         FROM transactions
        WHERE transferToAccountId IS NOT NULL
        GROUP BY transferToAccountId`,
    )
    .all() as unknown as Array<{ accountId: string; total: number }>;

  const recebidoPor = (accountId: string): number =>
    recebidos.find((r) => r.accountId === accountId)?.total ?? 0;

  return accounts.map((a) => ({
    ...a,
    balanceCents:
      a.openingCents +
      pick(totals, a.id, "INCOME") -
      pick(totals, a.id, "EXPENSE") +
      recebidoPor(a.id),
    monthInCents: pick(monthTotals, a.id, "INCOME"),
    monthOutCents: pick(monthTotals, a.id, "EXPENSE"),
  }));
}

/**
 * Quanto a fatura de um cartão soma num mês.
 *
 * Não é campo guardado: é a soma das compras cuja data de saída cai no mês —
 * e a data de saída de uma compra no cartão já é o vencimento da fatura
 * (ver resolveCashOutDate). Ou seja, a fatura É o conjunto de lançamentos
 * daquele mês naquele cartão, e por isso nunca fica desatualizada.
 */
export function getCardInvoice(cardId: string, month: string): number {
  const { start, end } = monthBounds(month);
  const db = getDb();

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amountCents), 0) AS total
         FROM transactions
        WHERE accountId = ? AND type = 'EXPENSE'
          AND transferToAccountId IS NULL
          AND date BETWEEN ? AND ?`,
    )
    .get(cardId, start, end) as { total: number };

  /*
   * A fatura que já estava aberta no dia do cadastro também conta.
   *
   * Quem cadastra um cartão informa "fatura em aberto hoje" — esse valor
   * aparecia no saldo do cartão mas NÃO na lista de contas a pagar, porque
   * aqui só se somava lançamento. Resultado: o cartão mostrava R$ 631,99 de
   * dívida e não havia nada para pagar.
   *
   * O saldo de abertura pertence à primeira fatura que vence a partir da data
   * do cadastro — calculada com a mesma regra de ciclo das compras, para não
   * existirem duas noções de "em que fatura isso cai".
   */
  const card = db
    .prepare(
      `SELECT openingCents, closingDay, dueDay, date(createdAt) AS criadoEm
         FROM accounts WHERE id = ? AND kind = 'CARTAO'`,
    )
    .get(cardId) as
    | {
        openingCents: number;
        closingDay: number | null;
        dueDay: number | null;
        criadoEm: string;
      }
    | undefined;

  if (!card || card.openingCents === 0 || !card.closingDay || !card.dueDay) {
    return row.total;
  }

  const mesDaAbertura = firstInvoiceDueDate(
    card.criadoEm,
    card.closingDay,
    card.dueDay,
  ).slice(0, 7);

  // openingCents de cartão é gravado negativo (dívida); a fatura é o módulo.
  return month === mesDaAbertura
    ? row.total + Math.abs(card.openingCents)
    : row.total;
}

/**
 * Paga a fatura do cartão como TRANSFERÊNCIA, não como despesa.
 *
 * As compras do cartão já entraram como gasto no mês do vencimento. Registrar
 * o pagamento da fatura como uma despesa nova contaria o mesmo dinheiro duas
 * vezes e dobraria o total do mês. Aqui o dinheiro só muda de lugar: sai da
 * conta corrente, entra no cartão (zerando a fatura).
 */
export function payCardInvoice(input: {
  cardId: string;
  fromAccountId: string;
  amountCents: number;
  date: string;
}): string {
  const card = getAccount(input.cardId);
  if (!card) throw new Error("Cartão não encontrado");

  const db = getDb();
  const id = newId();

  // categoryId é obrigatório no schema, mas transferência não tem categoria de
  // gasto. Usa a primeira disponível e fica fora de toda agregação por causa
  // do transferToAccountId — nenhum relatório a enxerga.
  const categoria = db.prepare(`SELECT id FROM categories LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (!categoria) throw new Error("Nenhuma categoria cadastrada");

  db.prepare(
    `INSERT INTO transactions
       (id, type, amountCents, date, description, nature, notes, categoryId,
        accountId, transferToAccountId, method)
     VALUES (?, 'EXPENSE', ?, ?, ?, 'VISTA', NULL, ?, ?, ?, 'TRANSFERENCIA')`,
  ).run(
    id,
    input.amountCents,
    input.date,
    `Pagamento fatura ${card.name}`,
    categoria.id,
    input.fromAccountId,
    input.cardId,
  );

  return id;
}

export function createAccount(input: {
  name: string;
  kind: AccountKind;
  openingCents: number;
  closingDay: number | null;
  dueDay: number | null;
  last4: string | null;
  creditLimitCents: number | null;
  overdraftLimitCents: number | null;
  bankIspb: string | null;
  bankName: string | null;
  logoUrl: string | null;
  color: string;
}): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO accounts (id, name, kind, openingCents, closingDay, dueDay, last4,
                              creditLimitCents, overdraftLimitCents, bankIspb,
                              bankName, logoUrl, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.kind,
      // Fatura de cartão é SEMPRE dívida: guardamos negativo, independente de
      // o usuário ter digitado com ou sem sinal. Se entrasse positivo, pagar a
      // fatura (que soma de volta) aumentaria a dívida em vez de zerá-la.
      input.kind === "CARTAO" ? -Math.abs(input.openingCents) : input.openingCents,
      // Fechamento/vencimento só existem em cartão. Guardar num débito seria
      // dado morto que a UI teria que aprender a ignorar.
      input.kind === "CARTAO" ? input.closingDay : null,
      input.kind === "CARTAO" ? input.dueDay : null,
      input.kind === "CARTAO" ? input.last4 : null,
      input.kind === "CARTAO" ? input.creditLimitCents : null,
      // Cheque especial só existe em conta, nunca em cartão.
      input.kind === "CARTAO" ? null : input.overdraftLimitCents,
      input.bankIspb,
      input.bankName,
      input.logoUrl,
      input.color,
    );
  return id;
}

/**
 * Edita uma conta/cartão já cadastrado.
 *
 * `openingCents` é o saldo INICIAL, não o atual: mexer nele reposiciona todo o
 * histórico, porque o saldo atual é sempre inicial + entradas − saídas. É
 * exatamente o que se quer quando o cadastro saiu errado — corrigir a origem em
 * vez de inventar um lançamento de acerto que sujaria o extrato.
 */
export function updateAccount(
  id: string,
  input: {
    name: string;
    kind: AccountKind;
    openingCents: number;
    closingDay: number | null;
    dueDay: number | null;
    last4: string | null;
    creditLimitCents: number | null;
    overdraftLimitCents: number | null;
    bankIspb: string | null;
    bankName: string | null;
    logoUrl: string | null;
    color: string;
  },
): void {
  getDb()
    .prepare(
      `UPDATE accounts
          SET name = ?, kind = ?, openingCents = ?, closingDay = ?, dueDay = ?,
              last4 = ?, creditLimitCents = ?, overdraftLimitCents = ?,
              bankIspb = ?, bankName = ?, logoUrl = ?, color = ?
        WHERE id = ?`,
    )
    .run(
      input.name,
      input.kind,
      // Fatura de cartão é SEMPRE dívida: guardamos negativo, independente de
      // o usuário ter digitado com ou sem sinal. Se entrasse positivo, pagar a
      // fatura (que soma de volta) aumentaria a dívida em vez de zerá-la.
      input.kind === "CARTAO" ? -Math.abs(input.openingCents) : input.openingCents,
      input.kind === "CARTAO" ? input.closingDay : null,
      input.kind === "CARTAO" ? input.dueDay : null,
      input.kind === "CARTAO" ? input.last4 : null,
      input.kind === "CARTAO" ? input.creditLimitCents : null,
      input.kind === "CARTAO" ? null : input.overdraftLimitCents,
      input.bankIspb,
      input.bankName,
      input.logoUrl,
      input.color,
      id,
    );
}

export function deleteAccount(id: string): void {
  // Os lançamentos sobrevivem e só perdem o vínculo (ON DELETE SET NULL):
  // o gasto aconteceu, independentemente da carteira ainda existir.
  getDb().prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}

// -------------------------------------------------------- fontes de renda

export function listIncomeSources(includeArchived = false): IncomeSource[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, kind, color, archived
         FROM income_sources
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all(includeArchived ? 1 : 0) as unknown as Array<
    Omit<IncomeSource, "archived"> & { archived: number }
  >;
  return rows.map((r) => ({ ...r, archived: r.archived === 1 }));
}

export function createIncomeSource(input: {
  name: string;
  kind: IncomeKind;
  color: string;
}): string {
  const id = newId();
  getDb()
    .prepare(`INSERT INTO income_sources (id, name, kind, color) VALUES (?, ?, ?, ?)`)
    .run(id, input.name, input.kind, input.color);
  return id;
}

export function deleteIncomeSource(id: string): void {
  getDb().prepare(`DELETE FROM income_sources WHERE id = ?`).run(id);
}

/**
 * Renda por fonte nos últimos N meses.
 * Serve para ver a estabilidade de cada emprego: CLT costuma ser uma linha
 * reta, PJ costuma ser um serrote — e é o serrote que define quanto dá para
 * assumir de custo fixo com segurança.
 */
export function getIncomeBySourceHistory(endMonth: string, count: number) {
  const db = getDb();
  const months = monthRange(endMonth, count);
  const { start } = monthBounds(months[0]);
  const { end } = monthBounds(endMonth);

  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, s.id AS sourceId, s.name AS sourceName,
              SUM(t.amountCents) AS total
         FROM transactions t
         JOIN income_sources s ON s.id = t.incomeSourceId
        WHERE t.type = 'INCOME' AND t.date BETWEEN ? AND ?
        GROUP BY month, s.id`,
    )
    .all(start, end) as unknown as Array<{
    month: string;
    sourceId: string;
    sourceName: string;
    total: number;
  }>;

  return { months, rows };
}

// ---------------------------------------------------------- contas a pagar

interface BillRow {
  id: string;
  name: string;
  recurrence: Recurrence;
  amountCents: number;
  dueDay: number | null;
  dueDate: string | null;
  categoryId: string;
  variable: number;
  active: number;
  barcode: string | null;
  notes: string | null;
}

function rowToBill(r: BillRow): Bill {
  return { ...r, variable: r.variable === 1, active: r.active === 1 };
}

export function listBills(includeInactive = false): Bill[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, recurrence, amountCents, dueDay, dueDate, categoryId,
              variable, active, barcode, notes
         FROM fixed_bills
        WHERE (? = 1 OR active = 1)
        ORDER BY recurrence, COALESCE(dueDay, 99), dueDate, name`,
    )
    .all(includeInactive ? 1 : 0) as unknown as BillRow[];
  return rows.map(rowToBill);
}

export function createBill(input: Omit<Bill, "id">): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO fixed_bills
         (id, name, recurrence, amountCents, dueDay, dueDate, categoryId,
          variable, active, barcode, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.recurrence,
      input.amountCents,
      input.dueDay,
      input.dueDate,
      input.categoryId,
      input.variable ? 1 : 0,
      input.active ? 1 : 0,
      input.barcode,
      input.notes,
    );
  return id;
}

export function setBillActive(id: string, active: boolean): void {
  getDb()
    .prepare(`UPDATE fixed_bills SET active = ? WHERE id = ?`)
    .run(active ? 1 : 0, id);
}

export function deleteBill(id: string): void {
  // O lançamento já feito sobrevive: ele é um fato do passado. Só perde o
  // vínculo com a conta (ON DELETE SET NULL), então o histórico de gastos
  // continua íntegro depois de excluir uma conta que não existe mais.
  getDb().prepare(`DELETE FROM fixed_bills WHERE id = ?`).run(id);
}

export function getBill(id: string): Bill | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, recurrence, amountCents, dueDay, dueDate, categoryId,
              variable, active, barcode, notes
         FROM fixed_bills WHERE id = ?`,
    )
    .get(id) as unknown as BillRow | undefined;
  return row ? rowToBill(row) : null;
}

/**
 * As contas de um mês, já com status resolvido.
 *
 * Regra do vencimento: dia 31 num mês de 30 dias vence no dia 30. Sem esse
 * clamp, "2026-02-31" seria uma data inexistente e toda comparação daria errado.
 */
export function getBillsForMonth(month: string): BillInMonth[] {
  const bills = listBills();
  const categories = new Map(listCategories(true).map((c) => [c.id, c]));
  const { start, end } = monthBounds(month);
  const lastDay = Number(end.split("-")[2]);
  const todayIso = today();

  // Uma consulta só para os pagamentos do mês inteiro, em vez de uma por conta.
  const payments = getDb()
    .prepare(
      `SELECT id, billId, amountCents
         FROM transactions
        WHERE billId IS NOT NULL AND date BETWEEN ? AND ?`,
    )
    .all(start, end) as unknown as Array<{
    id: string;
    billId: string;
    amountCents: number;
  }>;
  const paidByBill = new Map(payments.map((p) => [p.billId, p]));

  const result: BillInMonth[] = [];

  for (const bill of bills) {
    let dueDate: string;

    if (bill.recurrence === "MONTHLY") {
      const day = Math.min(bill.dueDay ?? 1, lastDay);
      dueDate = `${month}-${String(day).padStart(2, "0")}`;
    } else {
      // Boleto avulso só aparece no mês em que vence.
      if (!bill.dueDate || bill.dueDate < start || bill.dueDate > end) continue;
      dueDate = bill.dueDate;
    }

    const category = categories.get(bill.categoryId);
    if (!category) continue;

    const payment = paidByBill.get(bill.id);
    const daysUntilDue = daysBetween(todayIso, dueDate);

    const status: BillStatus = payment
      ? "PAID"
      : daysUntilDue < 0
        ? "OVERDUE"
        : daysUntilDue === 0
          ? "DUE_TODAY"
          : "UPCOMING";

    result.push({
      bill,
      category,
      dueDate,
      status,
      paidCents: payment?.amountCents ?? null,
      paidTransactionId: payment?.id ?? null,
      daysUntilDue,
    });
  }

  /*
   * A fatura de cada cartão entra aqui automaticamente, sem cadastro separado.
   *
   * Uma fatura É uma conta a pagar: tem valor e vencimento. Mas o valor não se
   * cadastra — ele é a soma das compras do mês naquele cartão. Por isso a
   * fatura é SINTETIZADA na leitura em vez de virar linha em fixed_bills: uma
   * linha guardada teria um valor que envelhece a cada nova compra.
   */
  for (const card of listAccounts().filter((a) => a.kind === "CARTAO")) {
    const valor = getCardInvoice(card.id, month);
    if (valor <= 0) continue;

    const dia = Math.min(card.dueDay ?? 1, lastDay);
    const dueDate = `${month}-${String(dia).padStart(2, "0")}`;
    const daysUntilDue = daysBetween(todayIso, dueDate);

    // Fatura paga = existe transferência para o cartão dentro do mês.
    const pagamento = getDb()
      .prepare(
        `SELECT id, amountCents FROM transactions
          WHERE transferToAccountId = ? AND date BETWEEN ? AND ?`,
      )
      .get(card.id, start, end) as { id: string; amountCents: number } | undefined;

    result.push({
      bill: {
        // Prefixo "card:" deixa claro que é sintética: não existe em
        // fixed_bills, e a UI usa isso para oferecer "pagar fatura" em vez da
        // quitação normal.
        id: `card:${card.id}`,
        name: `Fatura ${card.name}`,
        recurrence: "MONTHLY",
        amountCents: valor,
        dueDay: card.dueDay,
        dueDate: null,
        categoryId: "",
        variable: true,
        active: true,
        barcode: null,
        notes: null,
      },
      category: {
        id: `card:${card.id}`,
        name: "Cartão de crédito",
        kind: "NEED",
        color: card.color,
        icon: "credit-card",
        budgetCents: null,
        archived: false,
      },
      dueDate,
      status: pagamento
        ? "PAID"
        : daysUntilDue < 0
          ? "OVERDUE"
          : daysUntilDue === 0
            ? "DUE_TODAY"
            : "UPCOMING",
      paidCents: pagamento?.amountCents ?? null,
      paidTransactionId: pagamento?.id ?? null,
      daysUntilDue,
    });
  }

  /*
   * Lançamento com data FUTURA também é conta a pagar.
   *
   * Quem registra "mensalidade da faculdade, vence 09/09" está registrando um
   * compromisso — e esperava vê-lo em A pagar. Antes ele ficava só no extrato
   * de lançamentos, invisível justamente na tela feita para responder "o que
   * eu tenho que pagar".
   *
   * O que define "ainda a pagar" é NÃO TER CONTA atribuída, não só a data.
   * Atribuir a conta é o que a quitação faz — então, uma vez quitado, o
   * lançamento sai da lista sozinho, sem precisar de um campo "pago" separado
   * que poderia divergir do resto.
   *
   * Ficam de fora, para não contar duas vezes:
   *  - compra no cartão: já entra na fatura daquele cartão
   *  - quitação de conta (billId): a conta já está na lista por si
   */
  const agendados = getDb()
    .prepare(
      `SELECT t.id, t.description, t.amountCents, t.date, t.categoryId,
              c.name AS c_name, c.kind AS c_kind, c.color AS c_color,
              c.icon AS c_icon, c.budgetCents AS c_budget, c.archived AS c_archived
         FROM transactions t
         JOIN categories c ON c.id = t.categoryId
        WHERE t.type = 'EXPENSE'
          AND t.date BETWEEN ? AND ?
          AND t.date > ?
          AND t.billId IS NULL
          AND t.transferToAccountId IS NULL
          AND t.accountId IS NULL
        ORDER BY t.date`,
    )
    .all(start, end, todayIso) as unknown as Array<{
    id: string;
    description: string;
    amountCents: number;
    date: string;
    categoryId: string;
    c_name: string;
    c_kind: CategoryKind;
    c_color: string;
    c_icon: string;
    c_budget: number | null;
    c_archived: number;
  }>;

  for (const t of agendados) {
    result.push({
      bill: {
        // Prefixo "tx:" identifica que a origem é um lançamento agendado, e
        // não uma linha de fixed_bills. Quitar isso ATUALIZA o lançamento em
        // vez de criar outro — senão o gasto entraria duas vezes.
        id: `tx:${t.id}`,
        name: t.description,
        recurrence: "ONCE",
        amountCents: t.amountCents,
        dueDay: null,
        dueDate: t.date,
        categoryId: t.categoryId,
        variable: false,
        active: true,
        barcode: null,
        notes: null,
      },
      category: {
        id: t.categoryId,
        name: t.c_name,
        kind: t.c_kind,
        color: t.c_color,
        icon: t.c_icon,
        budgetCents: t.c_budget,
        archived: t.c_archived === 1,
      },
      dueDate: t.date,
      status: "UPCOMING",
      paidCents: null,
      paidTransactionId: null,
      daysUntilDue: daysBetween(todayIso, t.date),
    });
  }

  // Em aberto primeiro, e dentro disso a mais urgente no topo: a tela responde
  // "o que eu preciso pagar agora" sem o usuário ter que procurar.
  return result.sort((a, b) => {
    const aPaid = a.status === "PAID" ? 1 : 0;
    const bPaid = b.status === "PAID" ? 1 : 0;
    if (aPaid !== bPaid) return aPaid - bPaid;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

/** Diferença em dias entre duas datas "YYYY-MM-DD" (b - a). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  // Date.UTC evita que horário de verão jogue o resultado para 0,96 dia.
  const msPerDay = 86_400_000;
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay,
  );
}

/**
 * Quita uma conta: cria o lançamento e amarra ao boleto.
 * `amountCents` permite informar o valor real, que em conta variável (luz,
 * cartão) quase nunca é igual ao estimado.
 */
export function payBill(input: {
  billId: string;
  amountCents: number;
  date: string;
  accountId?: string | null;
  notes: string | null;
}): string {
  const bill = getBill(input.billId);
  if (!bill) throw new Error("Conta não encontrada");

  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO transactions
       (id, type, amountCents, date, description, nature, notes, categoryId,
        billId, accountId)
     VALUES (?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.amountCents,
    input.date,
    bill.name,
    // Conta mensal quitada é custo fixo; boleto avulso é gasto à vista.
    bill.recurrence === "MONTHLY" ? "FIXO" : "VISTA",
    input.notes,
    bill.categoryId,
    bill.id,
    input.accountId ?? null,
  );
  return id;
}

/**
 * Quita um lançamento que estava agendado para o futuro.
 *
 * ATUALIZA a linha existente em vez de criar outra: o gasto já foi registrado
 * quando você agendou; criar um segundo lançamento na hora de pagar contaria o
 * mesmo dinheiro duas vezes.
 *
 * O que muda é o que só se sabe na hora de pagar: de qual conta saiu, quanto
 * saiu de fato e em que dia.
 */
export function payScheduledTransaction(input: {
  transactionId: string;
  accountId: string;
  amountCents: number;
  date: string;
  method: PaymentMethod | null;
}): void {
  const conta = getAccount(input.accountId);
  if (!conta) throw new Error("Conta não encontrada");

  getDb()
    .prepare(
      `UPDATE transactions
          SET accountId = ?, amountCents = ?, date = ?, method = COALESCE(?, method)
        WHERE id = ?`,
    )
    .run(
      input.accountId,
      input.amountCents,
      input.date,
      input.method,
      input.transactionId,
    );
}

/** Desfaz o pagamento de uma conta no mês (apaga o lançamento vinculado). */
export function unpayBill(transactionId: string): void {
  getDb().prepare(`DELETE FROM transactions WHERE id = ?`).run(transactionId);
}

/**
 * Total comprometido no mês com contas ainda EM ABERTO.
 * É o número que transforma "sobrou R$ 800" em "sobrou R$ 800, mas R$ 620 já
 * têm dono" — a diferença entre achar que pode gastar e poder de fato.
 */
export function getOpenBillsTotal(month: string): number {
  return getBillsForMonth(month)
    .filter((b) => b.status !== "PAID")
    .reduce((acc, b) => acc + b.bill.amountCents, 0);
}

// --------------------------------------------------------------------- metas

export function listGoals(): Goal[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, targetCents, savedCents, deadline, archived
         FROM goals WHERE archived = 0 ORDER BY createdAt`,
    )
    .all() as unknown as Array<Omit<Goal, "archived"> & { archived: number }>;
  return rows.map((r) => ({ ...r, archived: r.archived === 1 }));
}

export function createGoal(input: {
  name: string;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
}): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO goals (id, name, targetCents, savedCents, deadline)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.targetCents, input.savedCents, input.deadline);
  return id;
}

export function addToGoal(id: string, cents: number): void {
  getDb()
    .prepare(`UPDATE goals SET savedCents = savedCents + ? WHERE id = ?`)
    .run(cents, id);
}

export function deleteGoal(id: string): void {
  getDb().prepare(`DELETE FROM goals WHERE id = ?`).run(id);
}

// ----------------------------------------------------------------- cenários

export function listScenarios(): Scenario[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, initialCents, monthlyCents, months, rateSource,
              ratePercentOfIndex, customAnnualRate, showReal
         FROM scenarios ORDER BY createdAt`,
    )
    .all() as unknown as Array<Omit<Scenario, "showReal"> & { showReal: number }>;
  return rows.map((r) => ({ ...r, showReal: r.showReal === 1 }));
}

export function createScenario(input: Omit<Scenario, "id">): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO scenarios
         (id, name, initialCents, monthlyCents, months, rateSource,
          ratePercentOfIndex, customAnnualRate, showReal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.initialCents,
      input.monthlyCents,
      input.months,
      input.rateSource,
      input.ratePercentOfIndex,
      input.customAnnualRate,
      input.showReal ? 1 : 0,
    );
  return id;
}

export function deleteScenario(id: string): void {
  getDb().prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
}

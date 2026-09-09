import "server-only";

import { newId } from "./db";
import { getFinancePgDb, withFinanceTransaction } from "./finance-pg-db";
import {
  addDays,
  addMonths,
  addMonthsToDate,
  daysInRange,
  firstInvoiceDueDate,
  formatDayMonth,
  formatMonth,
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
 * Acesso financeiro multiusuário no PostgreSQL. O escopo do usuário é aplicado
 * no contexto da conexão e reforçado por Row Level Security no schema.
 */
interface CategoryRow {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetCents: number | null;
  archived: boolean | number;
}

function isTrue(value: boolean | number): boolean {
  return value === true || value === 1;
}

function rowToCategory(r: CategoryRow): Category {
  return { ...r, archived: isTrue(r.archived) };
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

/** Colunas do lanÃ§amento + o JOIN das entidades exibidas junto. */
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
  c_archived: boolean | number;
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
      archived: isTrue(r.c_archived),
    },
    accountName: r.a_name,
    incomeSourceName: r.s_name,
  };
}

// ---------------------------------------------------------------- categorias

export async function listCategories(includeArchived = false): Promise<Category[]> {
  const db = getFinancePgDb();
  const rows = await db
    .prepare(
      `SELECT id, name, kind, color, icon, budgetCents, archived
         FROM categories
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all<CategoryRow>(includeArchived ? true : false);
  return rows.map(rowToCategory);
}

export async function createCategory(input: {
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetCents: number | null;
}): Promise<string> {
  const db = getFinancePgDb();
  const id = newId();
  // `run` é assíncrono: sem o await, a função voltava antes da linha existir e
  // um erro do banco virava rejeição sem dono.
  await db.prepare(
    `INSERT INTO categories (id, name, kind, color, icon, budgetCents)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.kind, input.color, input.icon, input.budgetCents);
  return id;
}

export async function updateCategoryBudget(id: string, budgetCents: number | null): Promise<void> {
  await getFinancePgDb()
    .prepare(`UPDATE categories SET budgetCents = ? WHERE id = ?`)
    .run(budgetCents, id);
}

export async function updateCategory(
  id: string,
  input: { name: string; kind: CategoryKind; color: string; budgetCents: number | null },
): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `UPDATE categories SET name = ?, kind = ?, color = ?, budgetCents = ? WHERE id = ?`,
    )
    .run(input.name, input.kind, input.color, input.budgetCents, id);
}

/**
 * Tira a categoria do caminho, sem nunca perder histórico.
 *
 * Categoria com lançamento não pode ser apagada de verdade: `transactions` e
 * `fixed_bills` têm chave estrangeira para cá, e mesmo que não tivessem, apagar
 * levaria junto a resposta para "quanto gastei com mercado no ano passado".
 * Nesse caso ela é ARQUIVADA — some das listas e do seletor, o histórico fica
 * inteiro. Sem nenhum lançamento, não há o que preservar e a linha vai embora.
 *
 * As regras de palavra-chave são da categoria e vão junto nos dois casos: sem
 * isso, a categoria apagada continuaria sendo sugerida na hora de lançar.
 */
export async function deleteCategory(id: string): Promise<"deleted" | "archived"> {
  const db = getFinancePgDb();
  const usos = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE categoryId = ?)
            + (SELECT COUNT(*) FROM fixed_bills WHERE categoryId = ?) AS n`,
    )
    .get<{ n: number }>(id, id);

  await db.prepare(`DELETE FROM category_rules WHERE categoryId = ?`).run(id);

  if (Number(usos?.n ?? 0) > 0) {
    await db.prepare(`UPDATE categories SET archived = 1 WHERE id = ?`).run(id);
    return "archived";
  }
  await db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
  return "deleted";
}

// --------------------------------------------------------------- lanÃ§amentos

export async function listTransactions(opts: {
  month?: string;
  categoryId?: string;
  limit?: number;
}): Promise<TransactionWithCategory[]> {
  const db = getFinancePgDb();
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

  // JOIN em vez de buscar categoria por lanÃ§amento: uma consulta em vez de N+1.
  const rows = await db.prepare(sql).all<TxJoinRow>(...params);
  return rows.map(rowToTransactionWithCategory);
}

export interface NewTransaction {
  type: TxType;
  /**
   * Em FIXO e VISTA: o valor do lanÃ§amento.
   * Em PARCELADO: o valor TOTAL da compra, que serÃ¡ dividido em `installments`.
   */
  amountCents: number;
  date: string;
  description: string;
  categoryId: string;
  nature: TxNature;
  /** NÃºmero de parcelas. SÃ³ usado quando nature === "PARCELADO". */
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
 * Em carteira comum, os dois sÃ£o a mesma data. No cartÃ£o de crÃ©dito nÃ£o sÃ£o: a
 * compra Ã© hoje, o dinheiro sai no vencimento da fatura em que ela caiu. Tratar
 * os dois como a mesma coisa adiantaria o gasto em atÃ© dois meses no fluxo de
 * caixa â€” que Ã© justamente o erro que faz alguÃ©m achar que o mÃªs fechou bem.
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

export async function getAccount(id: string): Promise<Account | null> {
  const row = await getFinancePgDb()
    .prepare(
      `SELECT id, name, kind, openingCents, closingDay, dueDay, last4,
              creditLimitCents, overdraftLimitCents, bankIspb, bankName, logoUrl,
              color, archived
         FROM accounts WHERE id = ?`,
    )
    .get<AccountRow>(id);
  return row ? { ...row, archived: isTrue(row.archived) } : null;
}

/**
 * Cria o lanÃ§amento. Em PARCELADO, cria UMA LINHA POR PARCELA, uma por mÃªs.
 *
 * Por que nÃ£o guardar uma linha sÃ³ com o total e calcular as parcelas na
 * leitura: porque o fechamento de cada mÃªs precisa somar o que realmente saiu
 * naquele mÃªs. Compra de R$ 1.200 em 6x lanÃ§ada inteira em setembro faria
 * setembro parecer catastrÃ³fico e outubro a fevereiro parecerem livres â€” e o
 * orÃ§amento por categoria, o alerta de estouro e a sobra mÃ©dia sairiam todos
 * errados. Cada parcela existe como fato do seu prÃ³prio mÃªs.
 *
 * Retorna o id da primeira linha criada.
 */
export async function createTransaction(input: NewTransaction): Promise<string> {
  const db = getFinancePgDb();
  const insert = db.prepare(INSERT_TX);

  /*
   * O ciclo da fatura vale para tudo que acontece DENTRO do cartÃ£o â€” inclusive
   * entrada, que no cartÃ£o sÃ³ existe como estorno. Um estorno lanÃ§ado no dia 12
   * abate a fatura em que a compra caiu, nÃ£o a do mÃªs corrente: sem passar pelo
   * ciclo, ele descontava de uma fatura e a compra ficava em outra.
   *
   * Numa carteira comum, entrada nÃ£o tem ciclo nenhum â€” salÃ¡rio nÃ£o cai em
   * fatura â€”, e resolveCashOutDate jÃ¡ devolve a prÃ³pria data.
   */
  const account = input.accountId ? await getAccount(input.accountId) : null;
  const { date: firstDate, purchaseDate } = resolveCashOutDate(input.date, account);

  if (input.nature !== "PARCELADO") {
    const id = newId();
    await insert.run(
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
      // Compra no cartÃ£o de crÃ©dito Ã© crÃ©dito por definiÃ§Ã£o â€” nÃ£o faz sentido
      // deixar o usuÃ¡rio escolher "pix" numa carteira do tipo CARTAO.
      account?.kind === "CARTAO" ? "CREDITO" : input.method,
    );
    return id;
  }

  const parts = Math.max(1, Math.floor(input.installments ?? 1));
  // DivisÃ£o que nÃ£o perde centavo â€” ver splitCents em money.ts.
  const values = splitCents(input.amountCents, parts);
  const purchaseId = newId();
  let firstId = "";

  // TransaÃ§Ã£o do SQLite: ou todas as parcelas entram, ou nenhuma. Uma compra
  // gravada pela metade seria pior que uma compra nÃ£o gravada.
  return withFinanceTransaction(async (transactionDb) => {
    const transactionInsert = transactionDb.prepare(INSERT_TX);
    try {
      for (const [i, cents] of values.entries()) {
      const id = newId();
      if (i === 0) firstId = id;
      await transactionInsert.run(
        id,
        input.type,
        cents,
        // A 1Âª parcela cai na fatura resolvida acima; as seguintes, um mÃªs
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
      }
    } catch (e) {
      throw e;
    }
    return firstId;
  });
}

/** Apaga uma compra parcelada inteira (todas as parcelas de uma vez). */
export async function deletePurchase(purchaseId: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM transactions WHERE purchaseId = ?`).run(purchaseId);
}

/**
 * Corrige um lançamento já feito.
 *
 * Mexe só no que é descrição do fato — data, valor, categoria, de onde saiu o
 * dinheiro. Não mexe em `nature`, `purchaseId` nem no número da parcela: isso
 * é a ESTRUTURA da compra, e trocar pelo formulário de uma parcela deixaria as
 * outras órfãs de uma compra que mudou de forma. Parcelamento se refaz
 * excluindo a compra inteira e lançando de novo.
 */
export async function updateTransaction(
  id: string,
  input: {
    type: TxType;
    amountCents: number;
    date: string;
    description: string;
    categoryId: string;
    accountId: string | null;
    incomeSourceId: string | null;
    method: PaymentMethod | null;
  },
): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `UPDATE transactions
          SET type = ?, amountCents = ?, date = ?, description = ?,
              categoryId = ?, accountId = ?, incomeSourceId = ?, method = ?
        WHERE id = ?`,
    )
    .run(
      input.type,
      input.amountCents,
      input.date,
      input.description,
      input.categoryId,
      input.accountId,
      input.incomeSourceId,
      input.method,
      id,
    );
}

export async function deleteTransaction(id: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM transactions WHERE id = ?`).run(id);
}

// -------------------------------------------------------------------- resumo

/**
 * Resumo de um mÃªs. Uma Ãºnica passada de agregaÃ§Ã£o no SQL, depois o cÃ¡lculo de
 * participaÃ§Ã£o/orÃ§amento em memÃ³ria (Ã© dezena de categorias, nÃ£o milhÃ£o de linhas).
 */
export async function getMonthSummary(month: string): Promise<MonthSummary> {
  const { start, end } = monthBounds(month);
  return { ...(await getRangeSummary(start, end)), month };
}

/**
 * Resumo de um intervalo QUALQUER de datas.
 *
 * Toda a agregaÃ§Ã£o do app era por mÃªs, o que impedia relatÃ³rio semanal, anual
 * ou de perÃ­odo customizado. `getMonthSummary` virou um caso particular disto.
 */
export async function getRangeSummary(
  start: string,
  end: string,
): Promise<Omit<MonthSummary, "month">> {
  const db = getFinancePgDb();

  // `transferToAccountId IS NULL` em toda agregaÃ§Ã£o de mÃªs: transferÃªncia entre
  // contas prÃ³prias nÃ£o Ã© receita nem despesa, Ã© o mesmo dinheiro mudando de
  // lugar. ContÃ¡-la inflaria o total do mÃªs e faria a regra 50/30/20 mentir.
  const totals = await db
    .prepare(
      `SELECT type, SUM(amountCents) AS total, COUNT(*) AS n
         FROM transactions
        WHERE date BETWEEN ? AND ? AND transferToAccountId IS NULL
        GROUP BY type`,
    )
    .all<{ type: TxType; total: number; n: number }>(start, end);

  const incomeCents = totals.find((t) => t.type === "INCOME")?.total ?? 0;
  const expenseCents = totals.find((t) => t.type === "EXPENSE")?.total ?? 0;
  const transactionCount = totals.reduce((acc, t) => acc + t.n, 0);

  const perCategory = await db
    .prepare(
      `SELECT c.id, c.name, c.kind, c.color, c.icon, c.budgetCents, c.archived,
              SUM(t.amountCents) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.categoryId
        WHERE t.date BETWEEN ? AND ? AND t.type = 'EXPENSE'
          AND t.transferToAccountId IS NULL
        GROUP BY c.id, c.name, c.kind, c.color, c.icon, c.budgetCents, c.archived
        ORDER BY total DESC`,
    )
    .all<CategoryRow & { total: number }>(start, end);

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

  // Renda por fonte: Ã© o que separa a parte previsÃ­vel (CLT) da variÃ¡vel (PJ).
  const incomeRows = await db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.color, s.archived, SUM(t.amountCents) AS total
         FROM transactions t
         JOIN income_sources s ON s.id = t.incomeSourceId
        WHERE t.date BETWEEN ? AND ? AND t.type = 'INCOME'
          AND t.transferToAccountId IS NULL
        GROUP BY s.id, s.name, s.kind, s.color, s.archived
        ORDER BY total DESC`,
    )
    .all(start, end) as unknown as Array<{
    id: string;
    name: string;
    kind: IncomeKind;
    color: string;
    archived: boolean | number;
    total: number;
  }>;

  const byIncomeSource: IncomeSourceTotal[] = incomeRows.map((r) => ({
    source: {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
    archived: isTrue(r.archived),
    },
    totalCents: r.total,
    share: safePercent(r.total, incomeCents),
  }));

  // Quanto do mÃªs Ã© compromisso herdado (parcela) e quanto Ã© custo fixo.
  const natureRows = await db
    .prepare(
      `SELECT nature, SUM(amountCents) AS total
         FROM transactions
        WHERE date BETWEEN ? AND ? AND type = 'EXPENSE'
          AND transferToAccountId IS NULL
        GROUP BY nature`,
    )
    .all<{ nature: TxNature; total: number }>(start, end);

  const installmentCents =
    natureRows.find((r) => r.nature === "PARCELADO")?.total ?? 0;
  const fixedCents = natureRows.find((r) => r.nature === "FIXO")?.total ?? 0;

  return {
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

/** LanÃ§amentos de um intervalo qualquer, do mais recente para o mais antigo. */
export async function listTransactionsInRange(
  start: string,
  end: string,
): Promise<TransactionWithCategory[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT ${TX_SELECT}
       ${TX_FROM}
        WHERE t.date BETWEEN ? AND ?
        ORDER BY t.date DESC, t.createdAt DESC`,
    )
    .all<TxJoinRow>(start, end);
  return rows.map(rowToTransactionWithCategory);
}

/**
 * SÃ©rie temporal do intervalo, agrupada por dia ou por mÃªs.
 *
 * A granularidade segue o tamanho do perÃ­odo: um relatÃ³rio anual em barras
 * diÃ¡rias vira 365 colunas ilegÃ­veis, e uma semana em barras mensais vira uma
 * coluna sÃ³. O corte Ã© em ~2 meses.
 */
export async function getRangeSeries(
  start: string,
  end: string,
): Promise<{ bucket: "dia" | "mes"; pontos: Array<{ label: string; incomeCents: number; expenseCents: number; balanceCents: number }> }> {
  const db = getFinancePgDb();
  const dias = daysInRange(start, end);
  const bucket: "dia" | "mes" = dias <= 62 ? "dia" : "mes";
  const corte = bucket === "dia" ? 10 : 7; // substr: 10 = data cheia, 7 = ano-mÃªs

  const rows = await db
    .prepare(
      `SELECT substr(date, 1, ${corte}) AS chave, type, SUM(amountCents) AS total
         FROM transactions
        WHERE date BETWEEN ? AND ? AND transferToAccountId IS NULL
        GROUP BY chave, type
        ORDER BY chave`,
    )
    .all<{ chave: string; type: TxType; total: number }>(start, end);

  // Preenche os buckets vazios: um buraco no meio da linha leria como
  // "sem dado" quando na verdade significa "nada movimentado".
  const chaves: string[] = [];
  if (bucket === "dia") {
    for (let d = start; d <= end; d = addDays(d, 1)) chaves.push(d);
  } else {
    for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = addMonths(m, 1)) {
      chaves.push(m);
    }
  }

  /*
   * Ãndice por chave+tipo. Antes eram dois `rows.find()` lineares POR bucket â€”
   * O(chaves Ã— linhas) sÃ³ para casar dado que jÃ¡ veio agrupado do SQL. Com
   * intervalo longo isso dominava o tempo da pÃ¡gina.
   */
  const porChave = new Map<string, number>();
  for (const r of rows) porChave.set(`${r.chave}:${r.type}`, r.total);

  const pontos = chaves.map((chave) => {
    const inc = porChave.get(`${chave}:INCOME`) ?? 0;
    const exp = porChave.get(`${chave}:EXPENSE`) ?? 0;
    return {
      label: bucket === "dia" ? formatDayMonth(chave) : formatMonth(chave),
      incomeCents: inc,
      expenseCents: exp,
      balanceCents: inc - exp,
    };
  });

  return { bucket, pontos };
}

/** Totais por forma de pagamento no intervalo â€” mostra por onde o dinheiro sai. */
export async function getRangeByMethod(
  start: string,
  end: string,
): Promise<Array<{ method: PaymentMethod | null; totalCents: number }>> {
  return (await getFinancePgDb())
    .prepare(
      `SELECT method, SUM(amountCents) AS totalCents
         FROM transactions
        WHERE date BETWEEN ? AND ? AND type = 'EXPENSE'
          AND transferToAccountId IS NULL
        GROUP BY method
        ORDER BY totalCents DESC`,
    )
    .all<{ method: PaymentMethod | null; totalCents: number }>(start, end);
}

/** Totais por conta/cartÃ£o no intervalo. */
export async function getRangeByAccount(
  start: string,
  end: string,
): Promise<Array<{ name: string | null; color: string | null; totalCents: number }>> {
  return (await getFinancePgDb())
    .prepare(
      `SELECT a.name, a.color, SUM(t.amountCents) AS totalCents
         FROM transactions t
    LEFT JOIN accounts a ON a.id = t.accountId
        WHERE t.date BETWEEN ? AND ? AND t.type = 'EXPENSE'
          AND t.transferToAccountId IS NULL
        GROUP BY t.accountId, a.name, a.color
        ORDER BY totalCents DESC`,
    )
    .all<{ name: string | null; color: string | null; totalCents: number }>(start, end);
}

/** SÃ©rie mensal para o grÃ¡fico de evoluÃ§Ã£o. Meses sem lanÃ§amento viram zero. */
export async function getMonthlySeries(endMonth: string, count: number) {
  const db = getFinancePgDb();
  const months = monthRange(endMonth, count);
  const { start } = monthBounds(months[0]);
  const { end } = monthBounds(endMonth);

  const rows = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, type, SUM(amountCents) AS total
         FROM transactions
        WHERE date BETWEEN ? AND ?
        GROUP BY month, type`,
    )
    .all<{ month: string; type: TxType; total: number }>(start, end);

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
 * Sobra mÃ©dia dos Ãºltimos N meses fechados (exclui o mÃªs corrente, que ainda
 * estÃ¡ incompleto e daria uma sobra otimista demais). Ã‰ o nÃºmero que vira o
 * aporte sugerido na projeÃ§Ã£o de investimento.
 */
export async function getAverageSurplus(endMonth: string, count = 3): Promise<number> {
  const series = (await getMonthlySeries(endMonth, count + 1)).slice(0, count);
  const withData = series.filter((s) => s.incomeCents > 0 || s.expenseCents > 0);
  if (withData.length === 0) return 0;
  const sum = withData.reduce((acc, s) => acc + s.balanceCents, 0);
  return Math.round(sum / withData.length);
}

/**
 * Tudo que jÃ¡ foi para categorias do tipo "poupar", desde sempre.
 * Ã‰ a proxy da reserva de emergÃªncia: o app nÃ£o conecta na corretora, entÃ£o o
 * que ele sabe sobre o seu patrimÃ´nio Ã© o que vocÃª registrou como guardado.
 */
export async function getTotalSavedAllTime(): Promise<number> {
  const row = await getFinancePgDb()
    .prepare(
      `SELECT COALESCE(SUM(t.amountCents), 0) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.categoryId
        WHERE c.kind = 'SAVE' AND t.type = 'EXPENSE'`,
    )
    .get<{ total: number }>();
  return row?.total ?? 0;
}

/** Soma mensal dos lanÃ§amentos marcados como recorrentes. */
export async function getRecurringMonthlyTotal(): Promise<number> {
  return (await listRecurring()).reduce((acc, t) => acc + t.amountCents, 0);
}

/** Custos fixos distintos â€” candidatos naturais a corte. */
export async function listRecurring(): Promise<TransactionWithCategory[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT DISTINCT ON (t.description, t.categoryId) ${TX_SELECT}
       ${TX_FROM}
        WHERE t.nature = 'FIXO' AND t.type = 'EXPENSE'
        ORDER BY t.description, t.categoryId, t.amountCents DESC`,
    )
    .all<TxJoinRow>();
  return rows.map(rowToTransactionWithCategory);
}

/**
 * Parcelas que ainda vÃ£o cair, a partir de amanhÃ£.
 *
 * Ã‰ o nÃºmero que responde "quanto do meu futuro jÃ¡ estÃ¡ comprometido?".
 * Uma compra em 12x nÃ£o dÃ³i no mÃªs da compra â€” dÃ³i nos onze meses seguintes,
 * e Ã© justamente por isso que ela some do radar de quem sÃ³ olha o mÃªs atual.
 */
export async function getFutureInstallments(): Promise<{
  totalCents: number;
  count: number;
  byMonth: Array<{ month: string; cents: number }>;
}> {
  const db = getFinancePgDb();
  const todayIso = today();

  const rows = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(amountCents) AS total, COUNT(*) AS n
         FROM transactions
        WHERE nature = 'PARCELADO' AND type = 'EXPENSE' AND date > ?
        GROUP BY month
        ORDER BY month`,
    )
    .all<{ month: string; total: number; n: number }>(todayIso);

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
  archived: boolean | number;
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT id, name, kind, openingCents, closingDay, dueDay, last4,
              creditLimitCents, overdraftLimitCents, bankIspb, bankName, logoUrl,
              color, archived
         FROM accounts
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all<AccountRow>(includeArchived ? true : false);
  return rows.map((r) => ({ ...r, archived: isTrue(r.archived) }));
}

/**
 * Carteiras com saldo CALCULADO: saldo inicial + entradas âˆ’ saÃ­das.
 *
 * O saldo nunca Ã© gravado numa coluna. Se fosse, bastaria excluir um
 * lanÃ§amento para o saldo guardado divergir do extrato â€” e nÃ£o haveria como
 * saber qual dos dois estÃ¡ certo. Calcular sempre custa uma agregaÃ§Ã£o e
 * elimina a classe inteira de bug.
 */
export async function listAccountsWithBalance(month: string): Promise<AccountWithBalance[]> {
  const db = getFinancePgDb();
  const accounts = await listAccounts();
  if (accounts.length === 0) return [];

  const { start, end } = monthBounds(month);

  const totals = await db
    .prepare(
      `SELECT accountId, type, SUM(amountCents) AS total
         FROM transactions
        WHERE accountId IS NOT NULL
        GROUP BY accountId, type`,
    )
    .all<{ accountId: string; type: TxType; total: number }>();

  const monthTotals = await db
    .prepare(
      `SELECT accountId, type, SUM(amountCents) AS total
         FROM transactions
        WHERE accountId IS NOT NULL AND date BETWEEN ? AND ?
        GROUP BY accountId, type`,
    )
    .all<{ accountId: string; type: TxType; total: number }>(start, end);

  const pick = (
    rows: typeof totals,
    accountId: string,
    type: TxType,
  ): number =>
    rows.find((r) => r.accountId === accountId && r.type === type)?.total ?? 0;

  /*
   * O lado que RECEBE a transferÃªncia.
   *
   * A linha de transferÃªncia Ã© gravada como EXPENSE na conta de origem â€” a
   * consulta acima jÃ¡ a subtrai de lÃ¡. Falta creditar o destino, senÃ£o o
   * dinheiro simplesmente evapora: some da conta corrente e nÃ£o aparece no
   * cartÃ£o nem na poupanÃ§a.
   *
   * No cartÃ£o, Ã© isso que zera a fatura: o saldo do cartÃ£o Ã© negativo pelas
   * compras, e a transferÃªncia entra somando de volta.
   */
  const recebidos = await db
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
 * Quanto a fatura de um cartÃ£o soma num mÃªs.
 *
 * NÃ£o Ã© campo guardado: Ã© a soma das compras cuja data de saÃ­da cai no mÃªs â€”
 * e a data de saÃ­da de uma compra no cartÃ£o jÃ¡ Ã© o vencimento da fatura
 * (ver resolveCashOutDate). Ou seja, a fatura Ã‰ o conjunto de lanÃ§amentos
 * daquele mÃªs naquele cartÃ£o, e por isso nunca fica desatualizada.
 */
export async function getCardInvoice(cardId: string, month: string): Promise<number> {
  const { start, end } = monthBounds(month);
  const db = getFinancePgDb();

  /*
   * Compras somam, estornos abatem.
   *
   * Uma ENTRADA no cartÃ£o sÃ³ existe como devoluÃ§Ã£o da loja â€” o dinheiro volta
   * para o limite. Contar sÃ³ as despesas deixaria a fatura acima do que o banco
   * cobra de verdade, e o saldo do cartÃ£o (que jÃ¡ desconta a entrada) nunca
   * bateria com o valor a pagar.
   */
  const row = await db
    .prepare(
      `SELECT COALESCE(
                SUM(CASE WHEN type = 'EXPENSE' THEN amountCents ELSE -amountCents END),
                0
              ) AS total
         FROM transactions
        WHERE accountId = ?
          AND transferToAccountId IS NULL
          AND date BETWEEN ? AND ?`,
    )
    .get<{ total: number }>(cardId, start, end);

  /*
   * A fatura que jÃ¡ estava aberta no dia do cadastro tambÃ©m conta.
   *
   * Quem cadastra um cartÃ£o informa "fatura em aberto hoje" â€” esse valor
   * aparecia no saldo do cartÃ£o mas NÃƒO na lista de contas a pagar, porque
   * aqui sÃ³ se somava lanÃ§amento. Resultado: o cartÃ£o mostrava R$ 631,99 de
   * dÃ­vida e nÃ£o havia nada para pagar.
   *
   * O saldo de abertura pertence Ã  primeira fatura que vence a partir da data
   * do cadastro â€” calculada com a mesma regra de ciclo das compras, para nÃ£o
   * existirem duas noÃ§Ãµes de "em que fatura isso cai".
   */
  const card = await db
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
    return row?.total ?? 0;
  }

  const mesDaAbertura = firstInvoiceDueDate(
    card.criadoEm,
    card.closingDay,
    card.dueDay,
  ).slice(0, 7);

  // openingCents de cartÃ£o Ã© gravado negativo (dÃ­vida); a fatura Ã© o mÃ³dulo.
  return month === mesDaAbertura
    ? (row?.total ?? 0) + Math.abs(card.openingCents)
    : row?.total ?? 0;
}

/**
 * Paga a fatura do cartÃ£o como TRANSFERÃŠNCIA, nÃ£o como despesa.
 *
 * As compras do cartÃ£o jÃ¡ entraram como gasto no mÃªs do vencimento. Registrar
 * o pagamento da fatura como uma despesa nova contaria o mesmo dinheiro duas
 * vezes e dobraria o total do mÃªs. Aqui o dinheiro sÃ³ muda de lugar: sai da
 * conta corrente, entra no cartÃ£o (zerando a fatura).
 */
export async function payCardInvoice(input: {
  cardId: string;
  fromAccountId: string;
  amountCents: number;
  date: string;
}): Promise<string> {
  const card = await getAccount(input.cardId);
  if (!card) throw new Error("CartÃ£o nÃ£o encontrado");

  const db = getFinancePgDb();
  const id = newId();

  // categoryId Ã© obrigatÃ³rio no schema, mas transferÃªncia nÃ£o tem categoria de
  // gasto. Usa a primeira disponÃ­vel e fica fora de toda agregaÃ§Ã£o por causa
  // do transferToAccountId â€” nenhum relatÃ³rio a enxerga.
  const categoria = await db.prepare(`SELECT id FROM categories LIMIT 1`).get<{ id: string }>() as
    | { id: string }
    | undefined;
  if (!categoria) throw new Error("Nenhuma categoria cadastrada");

  await db.prepare(
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

export async function createAccount(input: {
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
}): Promise<string> {
  const id = newId();
  await getFinancePgDb()
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
      // Fatura de cartÃ£o Ã© SEMPRE dÃ­vida: guardamos negativo, independente de
      // o usuÃ¡rio ter digitado com ou sem sinal. Se entrasse positivo, pagar a
      // fatura (que soma de volta) aumentaria a dÃ­vida em vez de zerÃ¡-la.
      input.kind === "CARTAO" ? -Math.abs(input.openingCents) : input.openingCents,
      // Fechamento/vencimento sÃ³ existem em cartÃ£o. Guardar num dÃ©bito seria
      // dado morto que a UI teria que aprender a ignorar.
      input.kind === "CARTAO" ? input.closingDay : null,
      input.kind === "CARTAO" ? input.dueDay : null,
      input.kind === "CARTAO" ? input.last4 : null,
      input.kind === "CARTAO" ? input.creditLimitCents : null,
      // Cheque especial sÃ³ existe em conta, nunca em cartÃ£o.
      input.kind === "CARTAO" ? null : input.overdraftLimitCents,
      input.bankIspb,
      input.bankName,
      input.logoUrl,
      input.color,
    );
  return id;
}

/**
 * Edita uma conta/cartÃ£o jÃ¡ cadastrado.
 *
 * `openingCents` Ã© o saldo INICIAL, nÃ£o o atual: mexer nele reposiciona todo o
 * histÃ³rico, porque o saldo atual Ã© sempre inicial + entradas âˆ’ saÃ­das. Ã‰
 * exatamente o que se quer quando o cadastro saiu errado â€” corrigir a origem em
 * vez de inventar um lanÃ§amento de acerto que sujaria o extrato.
 */
export async function updateAccount(
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
): Promise<void> {
  await getFinancePgDb()
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
      // Fatura de cartÃ£o Ã© SEMPRE dÃ­vida: guardamos negativo, independente de
      // o usuÃ¡rio ter digitado com ou sem sinal. Se entrasse positivo, pagar a
      // fatura (que soma de volta) aumentaria a dÃ­vida em vez de zerÃ¡-la.
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

export async function deleteAccount(id: string): Promise<void> {
  // Os lanÃ§amentos sobrevivem e sÃ³ perdem o vÃ­nculo (ON DELETE SET NULL):
  // o gasto aconteceu, independentemente da carteira ainda existir.
  await getFinancePgDb().prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}

// -------------------------------------------------------- fontes de renda

export async function listIncomeSources(includeArchived = false): Promise<IncomeSource[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT id, name, kind, color, archived
         FROM income_sources
        WHERE (? = 1 OR archived = 0)
        ORDER BY kind, name`,
    )
    .all(includeArchived ? true : false) as unknown as Array<
    Omit<IncomeSource, "archived"> & { archived: number }
  >;
  return rows.map((r) => ({ ...r, archived: r.archived === 1 }));
}

export async function createIncomeSource(input: {
  name: string;
  kind: IncomeKind;
  color: string;
}): Promise<string> {
  const id = newId();
  await getFinancePgDb()
    .prepare(`INSERT INTO income_sources (id, name, kind, color) VALUES (?, ?, ?, ?)`)
    .run(id, input.name, input.kind, input.color);
  return id;
}

export async function updateIncomeSource(
  id: string,
  input: { name: string; kind: IncomeKind; color: string },
): Promise<void> {
  await getFinancePgDb()
    .prepare(`UPDATE income_sources SET name = ?, kind = ?, color = ? WHERE id = ?`)
    .run(input.name, input.kind, input.color, id);
}

export async function deleteIncomeSource(id: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM income_sources WHERE id = ?`).run(id);
}

/**
 * Renda por fonte nos Ãºltimos N meses.
 * Serve para ver a estabilidade de cada emprego: CLT costuma ser uma linha
 * reta, PJ costuma ser um serrote â€” e Ã© o serrote que define quanto dÃ¡ para
 * assumir de custo fixo com seguranÃ§a.
 */
export async function getIncomeBySourceHistory(endMonth: string, count: number) {
  const db = getFinancePgDb();
  const months = monthRange(endMonth, count);
  const { start } = monthBounds(months[0]);
  const { end } = monthBounds(endMonth);

  const rows = await db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, s.id AS sourceId, s.name AS sourceName,
              SUM(t.amountCents) AS total
         FROM transactions t
         JOIN income_sources s ON s.id = t.incomeSourceId
        WHERE t.type = 'INCOME' AND t.date BETWEEN ? AND ?
        GROUP BY month, s.id, s.name`,
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
  variable: boolean | number;
  active: boolean | number;
  barcode: string | null;
  notes: string | null;
}

function rowToBill(r: BillRow): Bill {
  return { ...r, variable: isTrue(r.variable), active: isTrue(r.active) };
}

export async function listBills(includeInactive = false): Promise<Bill[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT id, name, recurrence, amountCents, dueDay, dueDate, categoryId,
              variable, active, barcode, notes
         FROM fixed_bills
        WHERE (? = 1 OR active = 1)
        ORDER BY recurrence, COALESCE(dueDay, 99), dueDate, name`,
    )
    .all<BillRow>(includeInactive ? true : false);
  return rows.map(rowToBill);
}

export async function createBill(input: Omit<Bill, "id">): Promise<string> {
  const id = newId();
  await getFinancePgDb()
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
      input.variable,
      input.active,
      input.barcode,
      input.notes,
    );
  return id;
}

export async function setBillActive(id: string, active: boolean): Promise<void> {
  await getFinancePgDb()
    .prepare(`UPDATE fixed_bills SET active = ? WHERE id = ?`)
    .run(active, id);
}

export async function updateBill(id: string, input: Omit<Bill, "id">): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `UPDATE fixed_bills
          SET name = ?, recurrence = ?, amountCents = ?, dueDay = ?, dueDate = ?,
              categoryId = ?, variable = ?, active = ?, barcode = ?, notes = ?
        WHERE id = ?`,
    )
    .run(
      input.name,
      input.recurrence,
      input.amountCents,
      input.dueDay,
      input.dueDate,
      input.categoryId,
      input.variable,
      input.active,
      input.barcode,
      input.notes,
      id,
    );
}

export async function deleteBill(id: string): Promise<void> {
  // O lanÃ§amento jÃ¡ feito sobrevive: ele Ã© um fato do passado. SÃ³ perde o
  // vÃ­nculo com a conta (ON DELETE SET NULL), entÃ£o o histÃ³rico de gastos
  // continua Ã­ntegro depois de excluir uma conta que nÃ£o existe mais.
  await getFinancePgDb().prepare(`DELETE FROM fixed_bills WHERE id = ?`).run(id);
}

export async function getBill(id: string): Promise<Bill | null> {
  const row = await getFinancePgDb()
    .prepare(
      `SELECT id, name, recurrence, amountCents, dueDay, dueDate, categoryId,
              variable, active, barcode, notes
         FROM fixed_bills WHERE id = ?`,
    )
    .get<BillRow>(id);
  return row ? rowToBill(row) : null;
}

/**
 * As contas de um mÃªs, jÃ¡ com status resolvido.
 *
 * Regra do vencimento: dia 31 num mÃªs de 30 dias vence no dia 30. Sem esse
 * clamp, "2026-02-31" seria uma data inexistente e toda comparaÃ§Ã£o daria errado.
 */
export async function getBillsForMonth(month: string): Promise<BillInMonth[]> {
  const bills = await listBills();
  const categories = new Map((await listCategories(true)).map((c) => [c.id, c]));
  const { start, end } = monthBounds(month);
  const lastDay = Number(end.split("-")[2]);
  const todayIso = today();

  // Uma consulta sÃ³ para os pagamentos do mÃªs inteiro, em vez de uma por conta.
  const payments = await getFinancePgDb()
    .prepare(
      `SELECT id, billId, amountCents
         FROM transactions
        WHERE billId IS NOT NULL AND date BETWEEN ? AND ?`,
    )
    .all<{ id: string; billId: string; amountCents: number }>(start, end) as Array<{
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
      // Boleto avulso sÃ³ aparece no mÃªs em que vence.
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
   * A fatura de cada cartÃ£o entra aqui automaticamente, sem cadastro separado.
   *
   * Uma fatura Ã‰ uma conta a pagar: tem valor e vencimento. Mas o valor nÃ£o se
   * cadastra â€” ele Ã© a soma das compras do mÃªs naquele cartÃ£o. Por isso a
   * fatura Ã© SINTETIZADA na leitura em vez de virar linha em fixed_bills: uma
   * linha guardada teria um valor que envelhece a cada nova compra.
   */
  for (const card of (await listAccounts()).filter((a) => a.kind === "CARTAO")) {
    const valor = await getCardInvoice(card.id, month);
    if (valor <= 0) continue;

    const dia = Math.min(card.dueDay ?? 1, lastDay);
    const dueDate = `${month}-${String(dia).padStart(2, "0")}`;
    const daysUntilDue = daysBetween(todayIso, dueDate);

    // Fatura paga = existe transferÃªncia para o cartÃ£o dentro do mÃªs.
    const pagamento = await getFinancePgDb()
      .prepare(
        `SELECT id, amountCents FROM transactions
          WHERE transferToAccountId = ? AND date BETWEEN ? AND ?`,
      )
      .get<{ id: string; amountCents: number }>(card.id, start, end);

    result.push({
      bill: {
        // Prefixo "card:" deixa claro que Ã© sintÃ©tica: nÃ£o existe em
        // fixed_bills, e a UI usa isso para oferecer "pagar fatura" em vez da
        // quitaÃ§Ã£o normal.
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
        name: "CartÃ£o de crÃ©dito",
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
   * LanÃ§amento com data FUTURA tambÃ©m Ã© conta a pagar.
   *
   * Quem registra "mensalidade da faculdade, vence 09/09" estÃ¡ registrando um
   * compromisso â€” e esperava vÃª-lo em A pagar. Antes ele ficava sÃ³ no extrato
   * de lanÃ§amentos, invisÃ­vel justamente na tela feita para responder "o que
   * eu tenho que pagar".
   *
   * O que define "ainda a pagar" Ã© NÃƒO TER CONTA atribuÃ­da, nÃ£o sÃ³ a data.
   * Atribuir a conta Ã© o que a quitaÃ§Ã£o faz â€” entÃ£o, uma vez quitado, o
   * lanÃ§amento sai da lista sozinho, sem precisar de um campo "pago" separado
   * que poderia divergir do resto.
   *
   * Ficam de fora, para nÃ£o contar duas vezes:
   *  - compra no cartÃ£o: jÃ¡ entra na fatura daquele cartÃ£o
   *  - quitaÃ§Ã£o de conta (billId): a conta jÃ¡ estÃ¡ na lista por si
   */
  const agendados = await getFinancePgDb()
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
    c_archived: boolean | number;
  }>;

  for (const t of agendados) {
    result.push({
      bill: {
        // Prefixo "tx:" identifica que a origem Ã© um lanÃ§amento agendado, e
        // nÃ£o uma linha de fixed_bills. Quitar isso ATUALIZA o lanÃ§amento em
        // vez de criar outro â€” senÃ£o o gasto entraria duas vezes.
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
        archived: isTrue(t.c_archived),
      },
      dueDate: t.date,
      status: "UPCOMING",
      paidCents: null,
      paidTransactionId: null,
      daysUntilDue: daysBetween(todayIso, t.date),
    });
  }

  // Em aberto primeiro, e dentro disso a mais urgente no topo: a tela responde
  // "o que eu preciso pagar agora" sem o usuÃ¡rio ter que procurar.
  return result.sort((a, b) => {
    const aPaid = a.status === "PAID" ? 1 : 0;
    const bPaid = b.status === "PAID" ? 1 : 0;
    if (aPaid !== bPaid) return aPaid - bPaid;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

/** DiferenÃ§a em dias entre duas datas "YYYY-MM-DD" (b - a). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  // Date.UTC evita que horÃ¡rio de verÃ£o jogue o resultado para 0,96 dia.
  const msPerDay = 86_400_000;
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay,
  );
}

/**
 * Quita uma conta: cria o lanÃ§amento e amarra ao boleto.
 * `amountCents` permite informar o valor real, que em conta variÃ¡vel (luz,
 * cartÃ£o) quase nunca Ã© igual ao estimado.
 */
export async function payBill(input: {
  billId: string;
  amountCents: number;
  date: string;
  accountId?: string | null;
  notes: string | null;
}): Promise<string> {
  const bill = await getBill(input.billId);
  if (!bill) throw new Error("Conta nÃ£o encontrada");

  const db = getFinancePgDb();
  const id = newId();
  await db.prepare(
    `INSERT INTO transactions
       (id, type, amountCents, date, description, nature, notes, categoryId,
        billId, accountId)
     VALUES (?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.amountCents,
    input.date,
    bill.name,
    // Conta mensal quitada Ã© custo fixo; boleto avulso Ã© gasto Ã  vista.
    bill.recurrence === "MONTHLY" ? "FIXO" : "VISTA",
    input.notes,
    bill.categoryId,
    bill.id,
    input.accountId ?? null,
  );
  return id;
}

/**
 * Quita um lanÃ§amento que estava agendado para o futuro.
 *
 * ATUALIZA a linha existente em vez de criar outra: o gasto jÃ¡ foi registrado
 * quando vocÃª agendou; criar um segundo lanÃ§amento na hora de pagar contaria o
 * mesmo dinheiro duas vezes.
 *
 * O que muda Ã© o que sÃ³ se sabe na hora de pagar: de qual conta saiu, quanto
 * saiu de fato e em que dia.
 */
export async function payScheduledTransaction(input: {
  transactionId: string;
  accountId: string;
  amountCents: number;
  date: string;
  method: PaymentMethod | null;
}): Promise<void> {
  const conta = await getAccount(input.accountId);
  if (!conta) throw new Error("Conta nÃ£o encontrada");

  await getFinancePgDb()
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

/** Desfaz o pagamento de uma conta no mÃªs (apaga o lanÃ§amento vinculado). */
export async function unpayBill(transactionId: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM transactions WHERE id = ?`).run(transactionId);
}

/**
 * Total comprometido no mÃªs com contas ainda EM ABERTO.
 * Ã‰ o nÃºmero que transforma "sobrou R$ 800" em "sobrou R$ 800, mas R$ 620 jÃ¡
 * tÃªm dono" â€” a diferenÃ§a entre achar que pode gastar e poder de fato.
 */
export async function getOpenBillsTotal(month: string): Promise<number> {
  return (await getBillsForMonth(month))
    .filter((b) => b.status !== "PAID")
    .reduce((acc, b) => acc + b.bill.amountCents, 0);
}

// --------------------------------------------------------------------- metas

export async function listGoals(): Promise<Goal[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT id, name, targetCents, savedCents, deadline, archived
         FROM goals WHERE archived = 0 ORDER BY createdAt`,
    )
    .all() as unknown as Array<Omit<Goal, "archived"> & { archived: boolean | number }>;
  return rows.map((r) => ({ ...r, archived: isTrue(r.archived) }));
}

export async function createGoal(input: {
  name: string;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
}): Promise<string> {
  const id = newId();
  await getFinancePgDb()
    .prepare(
      `INSERT INTO goals (id, name, targetCents, savedCents, deadline)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.targetCents, input.savedCents, input.deadline);
  return id;
}

export async function updateGoal(
  id: string,
  input: { name: string; targetCents: number; savedCents: number; deadline: string | null },
): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `UPDATE goals SET name = ?, targetCents = ?, savedCents = ?, deadline = ? WHERE id = ?`,
    )
    .run(input.name, input.targetCents, input.savedCents, input.deadline, id);
}

export async function addToGoal(id: string, cents: number): Promise<void> {
  await getFinancePgDb()
    .prepare(`UPDATE goals SET savedCents = savedCents + ? WHERE id = ?`)
    .run(cents, id);
}

export async function deleteGoal(id: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM goals WHERE id = ?`).run(id);
}

// ----------------------------------------------------------------- cenÃ¡rios

export async function listScenarios(): Promise<Scenario[]> {
  const rows = await getFinancePgDb()
    .prepare(
      `SELECT id, name, initialCents, monthlyCents, months, rateSource,
              ratePercentOfIndex, customAnnualRate, showReal
         FROM scenarios ORDER BY createdAt`,
    )
    .all() as unknown as Array<Omit<Scenario, "showReal"> & { showReal: boolean | number }>;
  return rows.map((r) => ({ ...r, showReal: isTrue(r.showReal) }));
}

export async function createScenario(input: Omit<Scenario, "id">): Promise<string> {
  const id = newId();
  await getFinancePgDb()
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
      input.showReal,
    );
  return id;
}

export async function updateScenario(id: string, input: Omit<Scenario, "id">): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `UPDATE scenarios
          SET name = ?, initialCents = ?, monthlyCents = ?, months = ?,
              rateSource = ?, ratePercentOfIndex = ?, customAnnualRate = ?, showReal = ?
        WHERE id = ?`,
    )
    .run(
      input.name,
      input.initialCents,
      input.monthlyCents,
      input.months,
      input.rateSource,
      input.ratePercentOfIndex,
      input.customAnnualRate,
      input.showReal,
      id,
    );
}

export async function deleteScenario(id: string): Promise<void> {
  await getFinancePgDb().prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
}


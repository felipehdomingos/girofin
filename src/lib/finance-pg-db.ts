import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getFinanceUserContext } from "./db";
import { paletteColor } from "./palette";

let pool: Pool | null = null;
const transactionContext = new AsyncLocalStorage<PoolClient>();

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada para o armazenamento financeiro.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

const columnNames: Record<string, string> = {
  annualPct: "annual_pct",
  amountCents: "amount_cents",
  archived: "archived",
  bankIspb: "bank_ispb",
  bankName: "bank_name",
  billId: "bill_id",
  budgetCents: "budget_cents",
  closingDay: "closing_day",
  createdAt: "created_at",
  creditLimitCents: "credit_limit_cents",
  customAnnualRate: "custom_annual_rate",
  dueDate: "due_date",
  dueDay: "due_day",
  incomeSourceId: "income_source_id",
  initialCents: "initial_cents",
  installmentNo: "installment_no",
  installmentTotal: "installment_total",
  logoUrl: "logo_url",
  monthlyCents: "monthly_cents",
  openingCents: "opening_cents",
  overdraftLimitCents: "overdraft_limit_cents",
  purchaseDate: "purchase_date",
  purchaseId: "purchase_id",
  ratePercentOfIndex: "rate_percent_of_index",
  rateSource: "rate_source",
  refDate: "ref_date",
  savedCents: "saved_cents",
  showReal: "show_real",
  targetCents: "target_cents",
  transferToAccountId: "transfer_to_account_id",
  fetchedAt: "fetched_at",
  accountId: "account_id",
  categoryId: "category_id",
  cacheKey: "cache_key",
};

const propertyNames = Object.fromEntries(
  Object.entries(columnNames).map(([camel, snake]) => [snake, camel]),
);
Object.assign(propertyNames, {
  accountid: "accountId",
  categoryid: "categoryId",
  createdat: "createdAt",
  fetchedat: "fetchedAt",
  incomesourceid: "incomeSourceId",
  installmentno: "installmentNo",
  installmenttotal: "installmentTotal",
  purchasedate: "purchaseDate",
  purchaseid: "purchaseId",
  ratepercentofindex: "ratePercentOfIndex",
  transfertoaccountid: "transferToAccountId",
  criadoem: "criadoEm",
  sourceid: "sourceId",
  sourcename: "sourceName",
  totalcents: "totalCents",
});
for (const camel of Object.keys(columnNames)) {
  propertyNames[camel.toLowerCase()] = camel;
}
const numericKeys = new Set([
  "annual_pct", "amount_cents", "budget_cents", "closing_day", "credit_limit_cents",
  "due_day", "initial_cents", "installment_no", "installment_total", "monthly_cents",
  "opening_cents", "overdraft_limit_cents", "rate_percent_of_index", "saved_cents",
  "target_cents", "hits", "total", "total_cents", "totalCents", "totalcents", "n",
  "amountcents", "budgetcents", "closingday", "creditlimitcents", "dueday",
  "initialcents", "monthlycents", "openingcents", "overdraftlimitcents",
  "ratepercentofindex", "savedcents", "targetcents", "installmentno", "installmenttotal",
]);

function mapRow<T extends QueryResultRow>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const mappedKey = propertyNames[key] ?? key;
      const normalizedValue =
        ["date", "purchaseDate", "dueDate", "refDate", "criadoEm"].includes(mappedKey) && value instanceof Date
          ? value.toISOString().slice(0, 10)
          : numericKeys.has(key) && typeof value === "string"
            ? Number(value)
            : value;
      return [mappedKey, normalizedValue];
    }),
  ) as T;
}

function mapResult<T extends QueryResultRow>(result: QueryResult<T>): QueryResult<T> {
  return { ...result, rows: result.rows.map(mapRow) };
}

function translateSql(sql: string, values: unknown[]): { sql: string; values: unknown[] } {
  let translated = sql;
  for (const [from, to] of Object.entries(columnNames)) {
    translated = translated.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  translated = translated
    .replace(/\?\s*=\s*1\b/g, "? = true")
    .replace(/\?\s*=\s*0\b/g, "? = false")
    .replace(/date\(created_at\)/g, "created_at::date")
    .replace(/substr\(date,/g, "substr(date::text,")
    .replace(/([a-z_]+)\s*=\s*0\b/g, "$1 = false")
    .replace(/([a-z_]+)\s*=\s*1\b/g, "$1 = true");

  let index = 0;
  translated = translated.replace(/\?/g, () => `$${++index}`);
  return { sql: translated, values };
}

async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  const current = transactionContext.getStore();
  const translated = translateSql(sql, values);
  if (current) return mapResult(await current.query<T>(translated.sql, translated.values));

  const userId = getFinanceUserContext();
  if (!userId) throw new Error("Sessão sem usuário para acesso financeiro.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = mapResult(await client.query<T>(translated.sql, translated.values));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class FinancePgDatabase {
  prepare(sql: string) {
    return {
      all: async <T extends QueryResultRow>(...values: unknown[]) => (await query<T>(sql, values)).rows,
      get: async <T extends QueryResultRow>(...values: unknown[]) => (await query<T>(sql, values)).rows[0] as T | undefined,
      run: async (...values: unknown[]) => (await query(sql, values)).rowCount ?? 0,
    };
  }

  async exec(sql: string): Promise<void> {
    const current = transactionContext.getStore();
    if (current) {
      await current.query(sql);
      return;
    }
    await query(sql);
  }
}

export function getFinancePgDb(): FinancePgDatabase {
  if (!getFinanceUserContext()) throw new Error("Sessão sem usuário para acesso financeiro.");
  return new FinancePgDatabase();
}

export async function pingFinancePostgres(): Promise<void> {
  await getPool().query("SELECT 1");
}

const defaultCategories = [
  ["Moradia", "NEED", "house"], ["Mercado", "NEED", "shopping-cart"],
  ["Transporte", "NEED", "bus"], ["Restaurantes", "WANT", "utensils"],
  ["Lazer", "WANT", "gamepad-2"], ["Saúde", "NEED", "heart-pulse"],
  ["Contas e serviços", "NEED", "receipt"], ["Compras", "WANT", "shopping-bag"],
  ["Assinaturas", "WANT", "repeat"], ["Educação", "NEED", "graduation-cap"],
  ["Investimentos", "SAVE", "trending-up"], ["Reserva de emergência", "SAVE", "shield"],
  ["Salário", "NEED", "wallet"],
] as const;

const defaultRules: Record<string, string[]> = {
  Mercado: ["mercado", "supermercado", "feira", "hortifruti", "acougue", "padaria", "carrefour", "assai", "atacadao", "pao de acucar", "extra", "big", "sacolao", "mercearia", "compras do mes"],
  Moradia: ["aluguel", "condominio", "iptu", "financiamento", "reforma", "faxina", "diarista", "gas", "seguro residencial"],
  Transporte: ["uber", "99", "taxi", "gasolina", "combustivel", "etanol", "alcool", "posto", "onibus", "metro", "passagem", "estacionamento", "pedagio", "ipva", "mecanico", "oficina", "pneu", "bilhete unico"],
  Saúde: ["farmacia", "remedio", "medico", "consulta", "exame", "dentista", "plano de saude", "unimed", "psicologo", "terapia", "academia", "drogaria", "droga raia", "pacheco"],
  "Contas e serviços": ["luz", "energia", "enel", "cemig", "copel", "agua", "sabesp", "internet", "vivo", "claro", "tim", "oi", "celular", "telefone", "seguro"],
  Educação: ["curso", "faculdade", "mensalidade", "escola", "livro", "material escolar", "udemy", "alura", "ingles"],
  Restaurantes: ["ifood", "rappi", "restaurante", "lanche", "lanchonete", "pizza", "hamburguer", "burger", "mcdonalds", "bk", "subway", "cafe", "starbucks", "padoca", "bar", "cerveja", "almoco", "jantar", "delivery", "sorvete"],
  Lazer: ["cinema", "show", "viagem", "hotel", "airbnb", "passeio", "parque", "jogo", "game", "steam", "playstation", "xbox", "livraria", "bilhete"],
  Assinaturas: ["netflix", "spotify", "amazon prime", "disney", "hbo", "max", "globoplay", "youtube premium", "icloud", "google one", "dropbox", "chatgpt", "assinatura", "mensalidade app", "apple"],
  Compras: ["roupa", "sapato", "tenis", "shopping", "amazon", "mercado livre", "shopee", "aliexpress", "magalu", "americanas", "presente", "eletronico", "celular novo", "movel", "decoracao"],
  Investimentos: ["investimento", "aporte", "tesouro", "cdb", "acoes", "fii", "etf", "corretora", "nuinvest", "rico", "clear", "xp", "bitcoin", "cripto"],
  "Reserva de emergência": ["reserva", "emergencia", "poupanca", "guardar"],
  Salário: ["salario", "pagamento", "pro labore", "freela", "freelance", "bonus", "13o", "decimo terceiro", "ferias", "rendimento", "dividendo", "pix recebido"],
};

export async function ensureFinanceSeedData(): Promise<void> {
  await withFinanceTransaction(async (db) => {
    const existing = await db.prepare("SELECT COUNT(*) AS n FROM categories").get<{ n: number }>();
    if (Number(existing?.n ?? 0) === 0) {
      const insert = db.prepare("INSERT INTO categories (id, name, kind, color, icon, budget_cents) VALUES (?, ?, ?, ?, ?, NULL)");
      const ids = new Map<string, string>();
      for (const [name, kind, icon] of defaultCategories) {
        const id = randomUUID();
        await insert.run(id, name, kind, paletteColor(ids.size), icon);
        ids.set(name, id);
      }
      const ruleInsert = db.prepare("INSERT INTO category_rules (keyword, category_id, source) VALUES (?, ?, 'seed') ON CONFLICT (user_id, keyword) DO NOTHING");
      for (const [name, keywords] of Object.entries(defaultRules)) {
        const categoryId = ids.get(name);
        if (!categoryId) continue;
        for (const keyword of keywords) await ruleInsert.run(keyword, categoryId);
      }
    }
    const income = await db.prepare("SELECT COUNT(*) AS n FROM income_sources").get<{ n: number }>();
    if (Number(income?.n ?? 0) === 0) {
      const insert = db.prepare("INSERT INTO income_sources (id, name, kind, color) VALUES (?, ?, ?, ?)");
      await insert.run(randomUUID(), "Salário CLT", "CLT", "#3987e5");
      await insert.run(randomUUID(), "Salário PJ", "PJ", "#199e70");
    }
  });
}

export async function withFinanceTransaction<T>(fn: (db: FinancePgDatabase) => Promise<T>): Promise<T> {
  const userId = getFinanceUserContext();
  if (!userId) throw new Error("Sessão sem usuário para acesso financeiro.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await transactionContext.run(client, () => fn(new FinancePgDatabase()));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { authConfigured } from "./auth-db";
import { paletteColor } from "./palette";

/**
 * Banco: SQLite via `node:sqlite` — o módulo embutido do Node.
 *
 * Por que não Prisma/Drizzle/better-sqlite3: todos dependem de binário nativo
 * (.exe do schema engine, ou .node compilado), e o Smart App Control desta
 * máquina bloqueia binário não assinado. `node:sqlite` vive dentro do node.exe,
 * que é assinado — então é a única opção que roda aqui sem desligar a proteção
 * do Windows. Ver README > "Restrições do ambiente".
 *
 * Efeito colateral bom: zero dependência nativa para instalar, e o "banco" é um
 * arquivo só (data/financeiro.db) que dá para copiar como backup.
 */

/**
 * Caminho do banco. `FINANCEIRO_DB` permite apontar para outro arquivo —
 * usado para demonstração e teste sem encostar nos seus dados reais, e útil
 * também para abrir um backup antigo sem sobrescrever o atual.
 *
 * A próxima etapa da migração multiusuário será exigir um `user_id` da sessão
 * para todas as leituras e escritas quando `authConfigured()` estiver ativo.
 */
const DB_PATH =
  process.env.FINANCEIRO_DB ?? path.join(process.cwd(), "data", "financeiro.db");
const DATA_DIR = path.dirname(DB_PATH);

export function resolveFinanceDbPath(userId?: string): string {
  if (!userId || !authConfigured()) {
    return DB_PATH;
  }

  return path.join(path.dirname(DB_PATH), "users", userId, "financeiro.db");
}

let instance: DatabaseSync | null = null;
const userInstances = new Map<string, DatabaseSync>();

/**
 * Trava do armazenamento financeiro compartilhado.
 *
 * Este banco não tem coluna `user_id` em tabela nenhuma: abrir o arquivo com
 * mais de um usuário autenticado significa todo mundo lendo e escrevendo os
 * lançamentos de todo mundo. Por isso a trava é fail-closed — a aplicação
 * quebra em vez de vazar.
 *
 * As exceções antigas foram removidas:
 *
 * - `WEBSITE_SITE_NAME.startsWith("girofin-staging-")` ligava o modo
 *   compartilhado por NOME DE HOST. O Azure App Service é quem define essa
 *   variável, então a proteção dependia de como o recurso foi batizado — e o
 *   slot real se chama `girofin-staging-1704`, ou seja, a trava estava
 *   desligada em staging sem ninguém ter pedido.
 * - `APP_ENV === "staging"` tinha o mesmo efeito e é ainda mais fácil de acabar
 *   copiado para produção numa troca de configuração.
 *
 * Sobra uma única chave explícita. Se staging precisa de dados para testar, o
 * caminho é um banco de staging com dados sintéticos — não relaxar o
 * isolamento entre usuários.
 */
function assertFinanceStorageMode(): void {
  if (
    (process.env.NODE_ENV === "production" || authConfigured()) &&
    process.env.ALLOW_UNSCOPED_FINANCEIRO_DB !== "true"
  ) {
    throw new Error(
      "Armazenamento financeiro compartilhado desativado: configure o repositório PostgreSQL multiusuário ou habilite o modo local explicitamente.",
    );
  }
}

/**
 * O migrate é idempotente e roda na primeira conexão do processo.
 * Com um único arquivo local e um único usuário, isso substitui bem uma
 * ferramenta de migration: não há deploy coordenado nem réplica para sincronizar.
 */
function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      kind        TEXT NOT NULL CHECK (kind IN ('NEED','WANT','SAVE')),
      color       TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT 'circle',
      budgetCents INTEGER,
      archived    INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Carteiras: onde o dinheiro está. Conta corrente, poupança, dinheiro
    -- vivo, cartão, corretora. Criada antes de transactions por causa da FK.
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      kind        TEXT NOT NULL DEFAULT 'CORRENTE'
                  CHECK (kind IN ('CORRENTE','POUPANCA','CARTEIRA','INVESTIMENTO','CARTAO')),
      -- Saldo no dia em que você cadastrou a carteira. O saldo atual NÃO é
      -- guardado: é sempre openingCents + entradas - saídas.
      -- Guardar um saldo mutável ao lado dos lançamentos criaria duas fontes
      -- de verdade que divergem no primeiro lançamento excluído.
      openingCents INTEGER NOT NULL DEFAULT 0,
      -- Só para kind = 'CARTAO'. É o que responde "quando essa parcela vem?":
      -- compra feita depois do fechamento não entra na fatura atual, entra na
      -- seguinte. Sem esses dois dias, a parcela cairia no mês da compra e o
      -- fluxo de caixa ficaria adiantado em até um mês inteiro.
      closingDay  INTEGER CHECK (closingDay BETWEEN 1 AND 31),
      dueDay      INTEGER CHECK (dueDay BETWEEN 1 AND 31),
      -- Só os 4 ÚLTIMOS dígitos, para diferenciar dois cartões do mesmo banco.
      -- O número completo nunca é guardado: é credencial de pagamento, e um
      -- app de controle de gastos não tem nada que fazer com ele.
      last4       TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 GLOB '[0-9][0-9][0-9][0-9]')),
      -- Limite total do cartão. Permite mostrar quanto do limite já foi usado,
      -- que é o número que evita a surpresa de ter o cartão recusado.
      creditLimitCents INTEGER,
      -- Limite do cheque especial, para conta corrente. NÃO entra no saldo
      -- disponível: é crédito do banco, não dinheiro seu. Somar os dois é
      -- exatamente o erro que faz alguém gastar o que não tem.
      -- Quanto foi USADO não é campo: é o próprio saldo quando fica negativo.
      overdraftLimitCents INTEGER,
      -- Identificação do banco na lista do Banco Central (via BrasilAPI).
      -- Guardamos o logo resolvido para a tela não depender da API toda vez.
      bankIspb    TEXT,
      bankName    TEXT,
      logoUrl     TEXT,
      color       TEXT NOT NULL DEFAULT '#3987e5',
      archived    INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Fontes de renda. Existe separado de categorias porque renda não entra na
    -- regra 50/30/20 (que classifica GASTO), e porque a diferença entre CLT e
    -- PJ é material: CLT é previsível, PJ varia e ainda tem imposto por fora.
    -- Misturar as duas numa linha só de "salário" esconde exatamente a parte
    -- instável da renda.
    CREATE TABLE IF NOT EXISTS income_sources (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      kind      TEXT NOT NULL DEFAULT 'OUTRO'
                CHECK (kind IN ('CLT','PJ','OUTRO')),
      color     TEXT NOT NULL DEFAULT '#199e70',
      archived  INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Contas fixas: o que se repete todo mês com valor previsível.
    -- Separadas de transactions porque são um COMPROMISSO FUTURO, não um fato
    -- passado. Misturar as duas coisas na mesma tabela faria o gasto do mês
    -- contar dinheiro que ainda não saiu.
    -- Criada ANTES de transactions: a FK billId aponta para cá, e o SQLite só
    -- resolve a referência na hora do INSERT — ordem invertida quebraria em runtime.
    CREATE TABLE IF NOT EXISTS fixed_bills (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      -- MONTHLY = conta fixa que volta todo mês (aluguel, luz, streaming).
      -- ONCE    = boleto avulso com data única (IPVA, matrícula, parcela).
      -- Mesma tabela porque a pergunta do usuário é a mesma nos dois casos:
      -- "o que eu tenho pra pagar?". Separar em duas telas duplicaria o fluxo.
      recurrence  TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (recurrence IN ('MONTHLY','ONCE')),
      -- Valor esperado. Contas variáveis (luz, água) usam isto como estimativa
      -- e o valor real é informado na hora de marcar como paga.
      amountCents INTEGER NOT NULL CHECK (amountCents > 0),
      -- MONTHLY: dia do vencimento (1-31). Dia 31 em mês curto cai no último dia.
      dueDay      INTEGER CHECK (dueDay BETWEEN 1 AND 31),
      -- ONCE: data exata do vencimento, "YYYY-MM-DD".
      dueDate     TEXT,
      categoryId  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      -- Conta que varia de valor todo mês (luz, água, cartão) x valor fixo
      -- (aluguel, streaming). Muda o texto que a UI mostra e se o valor é
      -- tratado como previsão ou como certeza.
      variable    INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      -- Linha digitável do boleto, opcional. Só para consulta na hora de pagar:
      -- fica no arquivo local, não vai para lugar nenhum.
      barcode     TEXT,
      notes       TEXT,
      createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
      -- Constraint de TABELA (envolve duas colunas), por isso vem depois de
      -- todas elas: no SQLite, um CHECK no meio da lista de colunas é erro de
      -- sintaxe. Garante que cada recorrência tenha o seu campo de vencimento.
      CHECK ((recurrence = 'MONTHLY' AND dueDay  IS NOT NULL)
          OR (recurrence = 'ONCE'    AND dueDate IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK (type IN ('INCOME','EXPENSE')),
      -- CHECK > 0: o sinal mora em type. Guardar despesa negativa duplicaria a
      -- fonte de verdade e faria toda soma depender de saber qual convenção usar.
      amountCents INTEGER NOT NULL CHECK (amountCents > 0),
      date        TEXT NOT NULL,
      description TEXT NOT NULL,
      -- Como o gasto se comporta no tempo:
      --   FIXO      = volta todo mês (aluguel, streaming)
      --   VISTA     = pagou e acabou
      --   PARCELADO = uma linha POR PARCELA, cada uma no seu mês
      -- Em PARCELADO, amountCents é o valor DA PARCELA. Guardar o total na
      -- primeira linha faria o mês da compra parecer catastrófico e os meses
      -- seguintes parecerem livres — os dois errados.
      nature      TEXT NOT NULL DEFAULT 'VISTA'
                  CHECK (nature IN ('FIXO','VISTA','PARCELADO')),
      -- Une as parcelas de uma mesma compra, para dar para excluir a compra
      -- inteira de uma vez e para somar o que ainda está comprometido.
      purchaseId  TEXT,
      installmentNo    INTEGER,
      installmentTotal INTEGER,
      -- De onde saiu / para onde entrou o dinheiro. Opcional: quem não quiser
      -- controlar por carteira continua lançando sem escolher.
      accountId   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      -- Só para entradas: qual emprego/fonte gerou esta receita.
      incomeSourceId TEXT REFERENCES income_sources(id) ON DELETE SET NULL,
      -- TRANSFERÊNCIA entre contas próprias (pagar a fatura do cartão, mandar
      -- para a poupança). Quando preenchido, a linha sai de "accountId" e entra
      -- aqui, e NÃO conta como despesa do mês.
      --
      -- É isso que impede a contagem dobrada: as compras do cartão já entraram
      -- como gasto no mês em que a fatura vence. Registrar o pagamento da
      -- fatura como uma despesa nova contaria o mesmo dinheiro duas vezes e
      -- dobraria o total do mês.
      transferToAccountId TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      -- COMO foi pago. Eixo diferente de "nature": "parcelado" diz como o
      -- gasto se distribui no tempo, "pix" diz por onde o dinheiro saiu.
      -- Um pix pode ser à vista e uma compra no crédito pode ser parcelada.
      method      TEXT CHECK (method IS NULL OR method IN
                  ('PIX','DEBITO','CREDITO','DINHEIRO','BOLETO','TRANSFERENCIA')),
      -- Quando a COMPRA aconteceu, se diferente de quando o dinheiro sai.
      -- Em compra no cartão, "date" é a data da fatura (quando sai do bolso) e
      -- "purchaseDate" é o dia da compra. Guardar só um dos dois obrigaria a
      -- escolher entre o fluxo de caixa certo e a memória do que foi comprado.
      purchaseDate TEXT,
      notes       TEXT,
      categoryId  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      -- Preenchido quando o lançamento é a quitação de uma conta fixa.
      -- É isso que responde "o aluguel de março já foi pago?" sem tabela extra
      -- de status: a existência do lançamento no mês É o pagamento.
      billId      TEXT REFERENCES fixed_bills(id) ON DELETE SET NULL,
      createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_cat_date ON transactions(categoryId, date DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_bill ON transactions(billId, date);
    -- O índice de purchaseId NÃO vem aqui: num banco antigo a coluna ainda não
    -- existe neste ponto, e o CREATE INDEX falharia antes da migração rodar.
    -- Ele é criado em migrateTransactionNature, depois do ALTER TABLE.

    CREATE TABLE IF NOT EXISTS goals (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      targetCents INTEGER NOT NULL CHECK (targetCents > 0),
      savedCents  INTEGER NOT NULL DEFAULT 0,
      deadline    TEXT,
      archived    INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      initialCents       INTEGER NOT NULL DEFAULT 0,
      monthlyCents       INTEGER NOT NULL DEFAULT 0,
      months             INTEGER NOT NULL DEFAULT 60,
      rateSource         TEXT NOT NULL DEFAULT 'CDI',
      ratePercentOfIndex REAL NOT NULL DEFAULT 100,
      customAnnualRate   REAL NOT NULL DEFAULT 12,
      showReal           INTEGER NOT NULL DEFAULT 1,
      createdAt          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Categorização automática. Cada regra é uma palavra-chave que aponta para
    -- uma categoria. 'seed' = embutida; 'learned' = criada quando o usuário
    -- corrige um palpite, que é como o acerto melhora com o uso.
    CREATE TABLE IF NOT EXISTS category_rules (
      keyword    TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      source     TEXT NOT NULL CHECK (source IN ('seed','learned')),
      hits       INTEGER NOT NULL DEFAULT 0,
      updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cache das séries do Banco Central. Mantém o app funcionando quando a
    -- API do BCB está fora do ar (acontece, sobretudo em fim de semana).
    CREATE TABLE IF NOT EXISTS rate_cache (
      series    TEXT PRIMARY KEY,
      annualPct REAL NOT NULL,
      refDate   TEXT NOT NULL,
      fetchedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Migração para bancos criados antes de existir `nature`.
 *
 * `CREATE TABLE IF NOT EXISTS` não altera tabela que já existe — quem já usou o
 * app ficaria com o schema velho e o app quebraria na primeira consulta. Isto
 * roda toda vez e não faz nada quando já está tudo no lugar.
 */
function migrateTransactionNature(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(transactions)`).all() as Array<{
    name: string;
  }>;
  const has = (name: string) => columns.some((c) => c.name === name);

  if (!has("nature")) {
    db.exec(
      `ALTER TABLE transactions ADD COLUMN nature TEXT NOT NULL DEFAULT 'VISTA'`,
    );
    // O antigo `recurring = 1` significava exatamente "custo fixo".
    if (has("recurring")) {
      db.exec(`UPDATE transactions SET nature = 'FIXO' WHERE recurring = 1`);
    }
  }
  if (!has("purchaseId")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN purchaseId TEXT`);
  }
  if (!has("installmentNo")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN installmentNo INTEGER`);
  }
  if (!has("installmentTotal")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN installmentTotal INTEGER`);
  }
  // FK em ALTER TABLE: o SQLite aceita a referência, mas não valida
  // retroativamente. Como as colunas nascem NULL, não há linha inválida.
  if (!has("accountId")) {
    db.exec(
      `ALTER TABLE transactions ADD COLUMN accountId TEXT REFERENCES accounts(id) ON DELETE SET NULL`,
    );
  }
  if (!has("incomeSourceId")) {
    db.exec(
      `ALTER TABLE transactions ADD COLUMN incomeSourceId TEXT REFERENCES income_sources(id) ON DELETE SET NULL`,
    );
  }
  if (!has("purchaseDate")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN purchaseDate TEXT`);
  }
  if (!has("method")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN method TEXT`);
  }
  if (!has("transferToAccountId")) {
    db.exec(
      `ALTER TABLE transactions ADD COLUMN transferToAccountId TEXT REFERENCES accounts(id) ON DELETE SET NULL`,
    );
  }

  const accountColumns = db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
    name: string;
  }>;
  const accountHas = (name: string) => accountColumns.some((c) => c.name === name);

  if (!accountHas("closingDay")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN closingDay INTEGER`);
  }
  if (!accountHas("dueDay")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN dueDay INTEGER`);
  }
  if (!accountHas("last4")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN last4 TEXT`);
  }
  if (!accountHas("creditLimitCents")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN creditLimitCents INTEGER`);
  }
  if (!accountHas("overdraftLimitCents")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN overdraftLimitCents INTEGER`);
  }
  if (!accountHas("bankIspb")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN bankIspb TEXT`);
  }
  if (!accountHas("bankName")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN bankName TEXT`);
  }
  if (!accountHas("logoUrl")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN logoUrl TEXT`);
  }

  // Agora sim: a coluna existe, tanto em banco novo quanto em banco antigo.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_purchase ON transactions(purchaseId)`);

  // `recurring` virou duplicata de `nature`. Duas fontes de verdade para o
  // mesmo fato é como os dois divergem depois. Removida.
  if (has("recurring")) {
    try {
      db.exec(`ALTER TABLE transactions DROP COLUMN recurring`);
    } catch {
      // SQLite antigo não suporta DROP COLUMN. A coluna sobra sem uso, o que
      // é inofensivo — nada no código a lê.
    }
  }
}

function openDbAtPath(dbPath: string): DatabaseSync {
  if (dbPath === DB_PATH) {
    if (instance) return instance;
  } else {
    const cached = userInstances.get(dbPath);
    if (cached) return cached;
  }

  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  migrate(db);
  migrateTransactionNature(db);
  seedIfEmpty(db);
  // Fora do seedIfEmpty: quem já usava o app tem categorias mas ainda não tem
  // fonte de renda nenhuma, e sem isso a tela de entrada abriria com o select
  // vazio. Esta função é idempotente.
  seedIncomeSources(db);

  if (dbPath === DB_PATH) {
    instance = db;
  } else {
    userInstances.set(dbPath, db);
  }

  return db;
}

export function getDbForUser(userId: string): DatabaseSync {
  if (!userId) {
    throw new Error("É necessário informar o usuário para abrir o banco financeiro escopado.");
  }
  return openDbAtPath(resolveFinanceDbPath(userId));
}

export async function getDbForCurrentUser(): Promise<DatabaseSync> {
  const { currentUserId } = await import("./auth-http");
  const userId = await currentUserId();
  if (!userId) {
    throw new Error("Sessão de usuário ausente para acessar o repositório financeiro.");
  }
  return getDbForUser(userId);
}

export function getDb(): DatabaseSync {
  assertFinanceStorageMode();
  return openDbAtPath(DB_PATH);
}

/** IDs curtos e ordenáveis por tempo, sem dependência externa. */
export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Categorias iniciais. Sem elas a primeira tela seria um formulário travado
 * ("selecione uma categoria" com zero opções) — o usuário teria que cadastrar
 * taxonomia antes de conseguir lançar o primeiro gasto.
 *
 * O `kind` de cada uma é o que faz a regra 50/30/20 funcionar desde o dia 1.
 */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as {
    n: number;
  };
  if (row.n > 0) return;

  // Cor vem de paletteColor() na ordem desta lista — não de hex escolhido a
  // olho. Ver src/lib/palette.ts para o resultado do validador.
  const defaults: Array<[string, "NEED" | "WANT" | "SAVE", string]> = [
    ["Moradia", "NEED", "house"],
    ["Mercado", "NEED", "shopping-cart"],
    ["Transporte", "NEED", "bus"],
    ["Restaurantes", "WANT", "utensils"],
    ["Lazer", "WANT", "gamepad-2"],
    ["Saúde", "NEED", "heart-pulse"],
    ["Contas e serviços", "NEED", "receipt"],
    ["Compras", "WANT", "shopping-bag"],
    ["Assinaturas", "WANT", "repeat"],
    ["Educação", "NEED", "graduation-cap"],
    ["Investimentos", "SAVE", "trending-up"],
    ["Reserva de emergência", "SAVE", "shield"],
    ["Salário", "NEED", "wallet"],
  ];

  const insert = db.prepare(
    `INSERT INTO categories (id, name, kind, color, icon, budgetCents)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  const idByName = new Map<string, string>();
  defaults.forEach(([name, kind, icon], i) => {
    const id = newId();
    insert.run(id, name, kind, paletteColor(i), icon);
    idByName.set(name, id);
  });

  seedRules(db, idByName);
  seedIncomeSources(db);
}

/**
 * Duas fontes de renda por padrão, porque é o caso do usuário: um emprego CLT
 * e um PJ. Dá para criar outras (freela, aluguel, dividendos) na tela.
 */
function seedIncomeSources(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM income_sources").get() as {
    n: number;
  };
  if (row.n > 0) return;

  const insert = db.prepare(
    `INSERT INTO income_sources (id, name, kind, color) VALUES (?, ?, ?, ?)`,
  );
  insert.run(newId(), "Salário CLT", "CLT", "#3987e5");
  insert.run(newId(), "Salário PJ", "PJ", "#199e70");
}

/**
 * Vocabulário inicial do categorizador: o que as pessoas de fato digitam.
 * Marcas reais ("ifood", "uber", "netflix") acertam muito mais que termos
 * genéricos, porque é assim que a despesa aparece no extrato e na memória.
 */
function seedRules(db: DatabaseSync, idByName: Map<string, string>): void {
  const rules: Record<string, string[]> = {
    Mercado: [
      "mercado", "supermercado", "feira", "hortifruti", "acougue", "padaria",
      "carrefour", "assai", "atacadao", "pao de acucar", "extra", "big",
      "sacolao", "mercearia", "compras do mes",
    ],
    Moradia: [
      "aluguel", "condominio", "iptu", "financiamento", "reforma", "faxina",
      "diarista", "gas", "seguro residencial",
    ],
    Transporte: [
      "uber", "99", "taxi", "gasolina", "combustivel", "etanol", "alcool",
      "posto", "onibus", "metro", "passagem", "estacionamento", "pedagio",
      "ipva", "mecanico", "oficina", "pneu", "bilhete unico",
    ],
    Saúde: [
      "farmacia", "remedio", "medico", "consulta", "exame", "dentista",
      "plano de saude", "unimed", "psicologo", "terapia", "academia",
      "drogaria", "droga raia", "pacheco",
    ],
    "Contas e serviços": [
      "luz", "energia", "enel", "cemig", "copel", "agua", "sabesp", "internet",
      "vivo", "claro", "tim", "oi", "celular", "telefone", "seguro",
    ],
    Educação: [
      "curso", "faculdade", "mensalidade", "escola", "livro", "material escolar",
      "udemy", "alura", "ingles",
    ],
    Restaurantes: [
      "ifood", "rappi", "restaurante", "lanche", "lanchonete", "pizza",
      "hamburguer", "burger", "mcdonalds", "bk", "subway", "cafe", "starbucks",
      "padoca", "bar", "cerveja", "almoco", "jantar", "delivery", "sorvete",
    ],
    Lazer: [
      "cinema", "show", "viagem", "hotel", "airbnb", "passeio", "parque",
      "jogo", "game", "steam", "playstation", "xbox", "livraria", "bilhete",
    ],
    Assinaturas: [
      "netflix", "spotify", "amazon prime", "disney", "hbo", "max", "globoplay",
      "youtube premium", "icloud", "google one", "dropbox", "chatgpt",
      "assinatura", "mensalidade app", "apple",
    ],
    Compras: [
      "roupa", "sapato", "tenis", "shopping", "amazon", "mercado livre",
      "shopee", "aliexpress", "magalu", "americanas", "presente", "eletronico",
      "celular novo", "movel", "decoracao",
    ],
    Investimentos: [
      "investimento", "aporte", "tesouro", "cdb", "acoes", "fii", "etf",
      "corretora", "nuinvest", "rico", "clear", "xp", "bitcoin", "cripto",
    ],
    "Reserva de emergência": ["reserva", "emergencia", "poupanca", "guardar"],
    Salário: [
      "salario", "pagamento", "pro labore", "freela", "freelance", "bonus",
      "13o", "decimo terceiro", "ferias", "rendimento", "dividendo", "pix recebido",
    ],
  };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO category_rules (keyword, categoryId, source)
     VALUES (?, ?, 'seed')`,
  );

  for (const [categoryName, keywords] of Object.entries(rules)) {
    const categoryId = idByName.get(categoryName);
    if (!categoryId) continue;
    for (const kw of keywords) insert.run(kw, categoryId);
  }
}

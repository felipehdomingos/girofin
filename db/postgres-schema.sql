-- Schema de producao. Execute antes do importador de dados.
-- Todas as tabelas financeiras sao isoladas por user_id.

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  birth_date DATE,
  city TEXT,
  state CHAR(2),
  avatar_data_url TEXT,
  google_subject TEXT UNIQUE,
  email_verified_at TIMESTAMPTZ,
  -- Janela de emissao de codigo de confirmacao, por usuario. Fica aqui, e nao
  -- na tabela de tokens (apagada a cada emissao), para nao ser zeravel de fora.
  email_verification_sends INTEGER NOT NULL DEFAULT 0,
  email_verification_window_start TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS app_refresh_user_idx ON app_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS app_refresh_family_idx ON app_refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('NEED', 'WANT', 'SAVE')),
  color TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'circle',
  budget_cents INTEGER,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'CORRENTE'
    CHECK (kind IN ('CORRENTE', 'POUPANCA', 'CARTEIRA', 'INVESTIMENTO', 'CARTAO')),
  opening_cents INTEGER NOT NULL DEFAULT 0,
  closing_day INTEGER CHECK (closing_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  last4 TEXT CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  credit_limit_cents INTEGER,
  overdraft_limit_cents INTEGER,
  bank_ispb TEXT,
  bank_name TEXT,
  logo_url TEXT,
  color TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'OUTRO' CHECK (kind IN ('CLT', 'PJ', 'OUTRO')),
  color TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS fixed_bills (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (recurrence IN ('MONTHLY', 'ONCE')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  due_date DATE,
  category_id TEXT NOT NULL,
  variable BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  barcode TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id),
  CHECK ((recurrence = 'MONTHLY' AND due_day IS NOT NULL)
      OR (recurrence = 'ONCE' AND due_date IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date DATE NOT NULL,
  description TEXT NOT NULL,
  nature TEXT NOT NULL DEFAULT 'VISTA' CHECK (nature IN ('FIXO', 'VISTA', 'PARCELADO')),
  purchase_id TEXT,
  installment_no INTEGER,
  installment_total INTEGER,
  account_id TEXT,
  income_source_id TEXT,
  transfer_to_account_id TEXT,
  method TEXT CHECK (method IS NULL OR method IN
    ('PIX', 'DEBITO', 'CREDITO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA')),
  purchase_date DATE,
  notes TEXT,
  category_id TEXT NOT NULL,
  bill_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id),
  FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id),
  FOREIGN KEY (user_id, income_source_id) REFERENCES income_sources(user_id, id),
  FOREIGN KEY (user_id, bill_id) REFERENCES fixed_bills(user_id, id)
);

CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS transactions_user_category_idx ON transactions(user_id, category_id, date DESC);
CREATE INDEX IF NOT EXISTS transactions_user_purchase_idx ON transactions(user_id, purchase_id);

-- O repositÃ³rio define o usuÃ¡rio no contexto da conexÃ£o. RLS Ã© uma segunda
-- barreira: uma consulta sem filtro explÃ­cito ainda nÃ£o pode cruzar usuÃ¡rios.
CREATE TABLE IF NOT EXISTS goals (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  saved_cents INTEGER NOT NULL DEFAULT 0,
  deadline DATE,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  initial_cents INTEGER NOT NULL DEFAULT 0,
  monthly_cents INTEGER NOT NULL DEFAULT 0,
  months INTEGER NOT NULL DEFAULT 60,
  rate_source TEXT NOT NULL DEFAULT 'CDI',
  rate_percent_of_index NUMERIC NOT NULL DEFAULT 100,
  custom_annual_rate NUMERIC NOT NULL DEFAULT 12,
  show_real BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS category_rules (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  category_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seed', 'learned')),
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, keyword),
  FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id)
);

CREATE TABLE IF NOT EXISTS rate_cache (
  series TEXT PRIMARY KEY,
  annual_pct NUMERIC NOT NULL,
  ref_date DATE NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O repositório define o usuário no contexto da conexão. RLS é uma segunda
-- barreira: uma consulta sem filtro explícito ainda não pode cruzar usuários.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories', 'accounts', 'income_sources', 'fixed_bills',
    'transactions', 'goals', 'scenarios', 'category_rules'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN user_id SET DEFAULT current_setting(''app.user_id'', true)::uuid',
      table_name
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_user_isolation ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_user_isolation ON %I USING (user_id = current_setting(''app.user_id'', true)::uuid) WITH CHECK (user_id = current_setting(''app.user_id'', true)::uuid)',
      table_name, table_name
    );
  END LOOP;
END $$;

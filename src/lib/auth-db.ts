import "server-only";

import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const RESET_TTL_SECONDS = 60 * 60;
const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 10;
const MAX_VERIFICATION_ATTEMPTS = 5;
/** Quantos códigos um MESMO usuário pode receber por janela. Ver createEmailVerification. */
const MAX_VERIFICATION_SENDS_PER_WINDOW = 3;
const EMAIL_VERIFICATION_WINDOW_SECONDS = 60 * 60;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

/**
 * TLS do banco. `rejectUnauthorized: false` aceitaria qualquer certificado,
 * inclusive um autoassinado por um atacante no meio do caminho — a conexão
 * ficaria cifrada mas sem autenticar o servidor, que é justamente o que o TLS
 * deveria garantir. Aqui a validação é sempre ligada e a CA vem de
 * `DATABASE_CA_CERT` (no Azure, a DigiCert Global Root G2).
 *
 * `DATABASE_SSL=false` desliga TLS por inteiro e existe só para o Postgres
 * local de desenvolvimento, que fala em loopback.
 */
function sslConfig(): false | { rejectUnauthorized: true; ca?: string } {
  if (process.env.DATABASE_SSL === "false") return false;
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: sslConfig(),
    });
  }
  return pool;
}

export function authConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
}

export async function ensureAuthSchema(): Promise<void> {
  if (!authConfigured()) throw new Error("Autenticação não configurada.");
  if (!schemaReady) {
    schemaReady = getPool()
      .query(`
        CREATE TABLE IF NOT EXISTS app_users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          email_verified_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone TEXT;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS birth_date DATE;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS city TEXT;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS state CHAR(2);
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_subject TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_google_subject_idx ON app_users(google_subject) WHERE google_subject IS NOT NULL;
        CREATE TABLE IF NOT EXISTS app_sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- Sem esta coluna, o cookie web e o access token do app viviam na mesma
        -- tabela e eram intercambiáveis: um cookie de 30 dias valia como Bearer
        -- e um access token de 15 min valia como cookie. As TTLs distintas só
        -- significam algo se a consulta souber qual tipo está validando.
        ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'web';
        ALTER TABLE app_sessions DROP CONSTRAINT IF EXISTS app_sessions_kind_check;
        ALTER TABLE app_sessions ADD CONSTRAINT app_sessions_kind_check
          CHECK (kind IN ('web','mobile_access'));
        CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions(user_id);
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
        CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id);
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- Contador de tentativas: sem ele o código de 6 dígitos (900 mil
        -- possibilidades, 10 minutos de validade, consulta indexada barata) é
        -- adivinhável por força bruta.
        ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS email_verification_user_idx ON email_verification_tokens(user_id);
        -- Janela de emissão de código POR USUÁRIO, no próprio app_users.
        -- O contador de tentativas vive na linha do token, que
        -- createEmailVerification apaga a cada emissão — ou seja, era zerável
        -- de fora por qualquer POST em /register ou /resend-verification.
        -- Limitando quantos códigos um usuário recebe por hora, o contador só
        -- pode ser zerado esse número de vezes, e o mesmo limite impede usar a
        -- rota como mail-bomb contra o dono do endereço.
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verification_sends INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verification_window_start TIMESTAMPTZ;
      `)
      .then(() => undefined)
      /*
       * Sem isto, a promessa REJEITADA ficava memoizada: um Postgres fora do ar
       * no primeiro acesso derrubava toda a autenticação até o processo
       * reiniciar, mesmo com o banco de volta. Limpar o cache faz a próxima
       * chamada tentar de novo.
       */
      .catch((error: unknown) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Chave que protege o hash de TODOS os tokens: sessão, access token, refresh
 * token, reset de senha e código de confirmação de e-mail. Não existe valor
 * padrão de propósito — um fallback versionado no repositório permitiria a
 * qualquer um recalcular o hash de qualquer token e forjar sessão.
 */
function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres).");
  }
  return secret;
}

function digest(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Hash sintético para o login gastar o mesmo tempo quando o e-mail não existe. */
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  phone?: string | null;
  birthDate?: string | null;
  city?: string | null;
  state?: string | null;
  avatarDataUrl?: string | null;
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthUser> {
  await ensureAuthSchema();
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const result = await getPool().query<AuthUser>(
    `INSERT INTO app_users (id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, (email_verified_at IS NOT NULL) AS "emailVerified"`,
    [randomUUID(), email, passwordHash, input.name.trim()],
  );
  return result.rows[0];
}

export async function authenticateUser(
  emailInput: string,
  password: string,
): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const result = await getPool().query<{
    id: string;
    email: string;
    name: string;
    password_hash: string;
    email_verified: boolean;
  }>(
    `SELECT id, email, name, password_hash, email_verified_at IS NOT NULL AS email_verified
       FROM app_users WHERE email = $1`,
    [normalizeEmail(emailInput)],
  );
  /*
   * Sempre roda o scrypt, mesmo sem usuário. Retornar cedo quando o e-mail não
   * existe deixava a resposta ordens de grandeza mais rápida nesse caso — dava
   * para enumerar quem tem conta só medindo o tempo. O hash falso tem o mesmo
   * formato e o mesmo tamanho derivado (64 bytes) que um real, então custa o
   * mesmo para verificar.
   */
  const user = result.rows[0];
  const stored = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(password, stored);
  if (!user || !valid) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.email_verified,
  };
}

export async function createSession(userId: string): Promise<string> {
  await ensureAuthSchema();
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `INSERT INTO app_sessions (id, user_id, token_hash, expires_at, kind)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'), 'web')`,
    [randomUUID(), userId, digest(token), SESSION_TTL_SECONDS],
  );
  return token;
}

export async function getUserBySession(token: string): Promise<AuthUser | null> {
  if (!authConfigured() || !token) return null;
  await ensureAuthSchema();
  const result = await getPool().query<AuthUser>(
    `SELECT u.id, u.email, u.name, (u.email_verified_at IS NOT NULL) AS "emailVerified",
            u.phone, u.birth_date AS "birthDate", u.city, u.state,
            u.avatar_data_url AS "avatarDataUrl"
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.kind = 'web' AND s.expires_at > now()`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!authConfigured() || !token) return;
  await ensureAuthSchema();
  await getPool().query(`DELETE FROM app_sessions WHERE token_hash = $1`, [digest(token)]);
}

export async function findOrCreateGoogleUser(input: {
  subject: string;
  email: string;
  name: string;
}): Promise<AuthUser> {
  await ensureAuthSchema();
  const email = normalizeEmail(input.email);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    /*
     * O vínculo por e-mail só vale para endereço já comprovado.
     *
     * Antes bastava `OR email = $2`, e isso permitia o seguinte: o atacante
     * cadastrava vitima@gmail.com com uma senha dele, nunca confirmava (não tem
     * o e-mail) e esperava. Quando a vítima entrava com o Google, a conta do
     * atacante era encontrada por e-mail, recebia o google_subject e — pelo
     * antigo COALESCE — era carimbada como confirmada. Era a própria vítima
     * quem ativava a conta do atacante, que depois entrava com a senha dele.
     */
    const existing = await client.query<AuthUser & { google_subject: string | null }>(
      `SELECT id, email, name, (email_verified_at IS NOT NULL) AS "emailVerified",
              phone, birth_date AS "birthDate", city, state,
              avatar_data_url AS "avatarDataUrl", google_subject
         FROM app_users
        WHERE google_subject = $1
           OR (email = $2 AND email_verified_at IS NOT NULL)
        LIMIT 1
        FOR UPDATE`,
      [input.subject, email],
    );
    const user = existing.rows[0];

    if (user) {
      if (user.google_subject && user.google_subject !== input.subject) {
        await client.query("ROLLBACK");
        throw new Error("GOOGLE_ACCOUNT_MISMATCH");
      }
      const updated = await client.query<AuthUser>(
        `UPDATE app_users SET google_subject = $1, email_verified_at = COALESCE(email_verified_at, now()), name = $2
          WHERE id = $3
          RETURNING id, email, name, (email_verified_at IS NOT NULL) AS "emailVerified",
                    phone, birth_date AS "birthDate", city, state, avatar_data_url AS "avatarDataUrl"`,
        [input.subject, input.name.trim() || user.name, user.id],
      );
      await client.query("COMMIT");
      return updated.rows[0];
    }

    /*
     * Pode existir um cadastro pendente com este e-mail — inclusive o do
     * atacante do cenário acima. Quem chegou aqui provou a posse do endereço
     * (o callback do Google exige email_verified); quem criou o cadastro
     * pendente nunca provou. O pendente é descartado.
     */
    await client.query(
      `DELETE FROM app_users
        WHERE email = $1 AND email_verified_at IS NULL AND google_subject IS NULL`,
      [email],
    );

    const created = await client.query<AuthUser>(
      `INSERT INTO app_users (id, email, password_hash, name, email_verified_at, google_subject)
       VALUES ($1, $2, $3, $4, now(), $5)
       RETURNING id, email, name, (email_verified_at IS NOT NULL) AS "emailVerified"`,
      [randomUUID(), email, `google$${randomBytes(32).toString("hex")}`, input.name.trim() || email, input.subject],
    );
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Revoga sessões do usuário. O escopo importa: sair no celular não deve
 * derrubar o navegador, e vice-versa. `"all"` fica para troca de senha e
 * suspeita de comprometimento, onde derrubar tudo é o comportamento certo.
 */
export async function revokeAllSessions(
  userId: string,
  scope: "web" | "mobile" | "all" = "all",
): Promise<void> {
  if (!authConfigured() || !userId) return;
  await ensureAuthSchema();

  if (scope === "web") {
    await getPool().query(
      `DELETE FROM app_sessions WHERE user_id = $1 AND kind = 'web'`,
      [userId],
    );
    return;
  }

  if (scope === "mobile") {
    await getPool().query(
      `DELETE FROM app_sessions WHERE user_id = $1 AND kind = 'mobile_access'`,
      [userId],
    );
    await getPool().query(
      `UPDATE app_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`,
      [userId],
    );
    return;
  }

  await getPool().query(`DELETE FROM app_sessions WHERE user_id = $1`, [userId]);
  await getPool().query(
    `UPDATE app_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`,
    [userId],
  );
}

export async function updateUserProfile(input: {
  userId: string;
  name: string;
  phone: string | null;
  birthDate: string | null;
  city: string | null;
  state: string | null;
  avatarDataUrl: string | null;
}): Promise<AuthUser> {
  await ensureAuthSchema();
  const result = await getPool().query<AuthUser>(
    `UPDATE app_users
        SET name = $1, phone = $2, birth_date = $3, city = $4, state = $5,
            avatar_data_url = $6
      WHERE id = $7
      RETURNING id, email, name, (email_verified_at IS NOT NULL) AS "emailVerified",
                phone, birth_date AS "birthDate", city, state,
                avatar_data_url AS "avatarDataUrl"`,
    [input.name, input.phone, input.birthDate, input.city, input.state, input.avatarDataUrl, input.userId],
  );
  if (!result.rows[0]) throw new Error("USER_NOT_FOUND");
  return result.rows[0];
}

export async function getUserByAccessToken(token: string): Promise<AuthUser | null> {
  if (!authConfigured() || !token) return null;
  await ensureAuthSchema();
  const result = await getPool().query<AuthUser>(
    `SELECT u.id, u.email, u.name, (u.email_verified_at IS NOT NULL) AS "emailVerified",
            u.phone, u.birth_date AS "birthDate", u.city, u.state,
            u.avatar_data_url AS "avatarDataUrl"
       FROM app_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.kind = 'mobile_access' AND s.expires_at > now()`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}

export interface MobileSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

async function issueMobileTokens(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  userId: string,
  familyId: string,
): Promise<MobileSession> {
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(48).toString("base64url");
  await client.query(
    `INSERT INTO app_sessions (id, user_id, token_hash, expires_at, kind)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'), 'mobile_access')`,
    [randomUUID(), userId, digest(accessToken), ACCESS_TOKEN_TTL_SECONDS],
  );
  await client.query(
    `INSERT INTO app_refresh_tokens (id, user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))`,
    [randomUUID(), userId, familyId, digest(refreshToken), REFRESH_TOKEN_TTL_SECONDS],
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
  };
}

export async function createMobileSession(userId: string): Promise<MobileSession> {
  await ensureAuthSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const session = await issueMobileTokens(client, userId, randomUUID());
    await client.query("COMMIT");
    return session;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateMobileSession(refreshToken: string): Promise<MobileSession | null> {
  if (!refreshToken) return null;
  await ensureAuthSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      token_hash: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, family_id, token_hash, revoked_at, expires_at
         FROM app_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [digest(refreshToken)],
    );
    const token = result.rows[0];
    if (!token) {
      await client.query("ROLLBACK");
      return null;
    }
    const invalid = token.revoked_at || token.expires_at.getTime() <= Date.now();
    if (invalid) {
      // Replay de um refresh token revogado invalida toda a família.
      if (token.revoked_at) {
        await client.query(
          `UPDATE app_refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
             WHERE family_id = $1`,
          [token.family_id],
        );
      }
      await client.query("COMMIT");
      return null;
    }
    const next = await issueMobileTokens(client, token.user_id, token.family_id);
    await client.query(
      `UPDATE app_refresh_tokens
          SET revoked_at = now(), replaced_by_hash = $1, last_used_at = now()
        WHERE id = $2`,
      [digest(next.refreshToken), token.id],
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeMobileRefreshToken(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await ensureAuthSchema();
  await getPool().query(
    `UPDATE app_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1`,
    [digest(refreshToken)],
  );
}

export async function createPasswordReset(
  emailInput: string,
): Promise<{ token: string; name: string; email: string } | null> {
  await ensureAuthSchema();
  const result = await getPool().query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM app_users WHERE email = $1`,
    [normalizeEmail(emailInput)],
  );
  const user = result.rows[0];
  if (!user) return null;
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
    [randomUUID(), user.id, digest(token), RESET_TTL_SECONDS],
  );
  return { token, name: user.name, email: user.email };
}

/**
 * Emite um código de confirmação — respeitando o teto por usuário.
 *
 * Devolve `null` quando o usuário já recebeu códigos demais na janela. Quem
 * chama trata isso como "não enviei" e responde a mesma coisa de sempre: o
 * limite não pode virar oráculo de enumeração.
 *
 * O teto existe por dois motivos. Primeiro, esta função apaga o código anterior
 * e insere um com `attempts = 0` — sem limite, qualquer um zerava o contador
 * anti-força-bruta do código de 6 dígitos à vontade, por uma rota que só
 * limitava por IP (trocável). Com no máximo `MAX_VERIFICATION_SENDS_PER_WINDOW`
 * emissões por hora, o atacante tem 15 palpites por hora dentro de 900 mil
 * possibilidades. Segundo, quem dispara o envio escolhe o destinatário e o
 * volume: sem teto por usuário, a rota é mail-bomb contra o dono do endereço e
 * queima de cota do provedor de e-mail.
 *
 * A janela mora em `app_users` (e não na tabela de tokens, que é apagada a cada
 * emissão) justamente para não ser zerável de fora.
 */
export async function createEmailVerification(
  userId: string,
): Promise<{ code: string; email: string; name: string } | null> {
  await ensureAuthSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const user = await client.query<{ email: string; name: string; sends: number }>(
      `UPDATE app_users
          SET email_verification_window_start = CASE
                WHEN email_verification_window_start IS NULL
                  OR email_verification_window_start < now() - ($2 * interval '1 second')
                THEN now() ELSE email_verification_window_start END,
              email_verification_sends = CASE
                WHEN email_verification_window_start IS NULL
                  OR email_verification_window_start < now() - ($2 * interval '1 second')
                THEN 1 ELSE email_verification_sends + 1 END
        WHERE id = $1
        RETURNING email, name, email_verification_sends AS sends`,
      [userId, EMAIL_VERIFICATION_WINDOW_SECONDS],
    );
    const row = user.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new Error("USER_NOT_FOUND");
    }

    if (row.sends > MAX_VERIFICATION_SENDS_PER_WINDOW) {
      // Desfaz o incremento: o balde fica cheio até a janela virar, em vez de
      // empurrar o início da janela para frente a cada tentativa recusada.
      await client.query("ROLLBACK");
      return null;
    }

    const code = String(randomInt(100000, 1000000));
    await client.query(
      `DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    await client.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
      [randomUUID(), userId, digest(`${row.email}:${code}`), EMAIL_VERIFICATION_TTL_SECONDS],
    );
    await client.query("COMMIT");
    return { code, email: row.email, name: row.name };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Usuário com cadastro pendente de confirmação. Serve ao reenvio de código:
 * sem isso, um envio de e-mail que falhasse deixava a conta inacessível para
 * sempre — registrar de novo dava 409, entrar dava 403 e não havia como pedir
 * outro código.
 */
export async function findUnverifiedUserByEmail(
  emailInput: string,
): Promise<{ id: string } | null> {
  await ensureAuthSchema();
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM app_users WHERE email = $1 AND email_verified_at IS NULL`,
    [normalizeEmail(emailInput)],
  );
  return result.rows[0] ?? null;
}

/**
 * Desfaz um cadastro cujo e-mail de confirmação não chegou a sair. Só remove
 * conta ainda não confirmada — uma confirmada nunca é apagada por aqui.
 */
export async function deleteUnverifiedUser(userId: string): Promise<void> {
  await ensureAuthSchema();
  await getPool().query(
    `DELETE FROM app_users WHERE id = $1 AND email_verified_at IS NULL`,
    [userId],
  );
}

export async function verifyEmail(emailInput: string, code: string): Promise<boolean> {
  if (!emailInput || !/^\d{6}$/.test(code)) return false;
  await ensureAuthSchema();
  const email = normalizeEmail(emailInput);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    /*
     * A busca é pelo USUÁRIO, não pelo hash do código.
     *
     * Procurando por `token_hash = digest(email:code)`, um palpite errado
     * simplesmente não casava com linha nenhuma — não havia onde registrar a
     * tentativa. Com 900 mil códigos possíveis, 10 minutos de validade e uma
     * consulta indexada barata (sem scrypt no caminho), dava para varrer metade
     * do espaço dentro da janela. Localizando a linha pelo e-mail dá para
     * contar os erros e queimar o código antes disso.
     */
    const found = await client.query<{
      id: string;
      user_id: string;
      token_hash: string;
      attempts: number;
    }>(
      `SELECT t.id, t.user_id, t.token_hash, t.attempts
         FROM email_verification_tokens t
         JOIN app_users u ON u.id = t.user_id
        WHERE u.email = $1 AND t.used_at IS NULL AND t.expires_at > now()
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE OF t`,
      [email],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }

    if (row.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      // Queima o código. A pessoa pede outro por /resend-verification.
      await client.query(
        `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return false;
    }

    const expected = Buffer.from(row.token_hash, "hex");
    const actual = Buffer.from(digest(`${email}:${code}`), "hex");
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      await client.query(
        `UPDATE email_verification_tokens SET attempts = attempts + 1 WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return false;
    }

    await client.query(`UPDATE app_users SET email_verified_at = now() WHERE id = $1`, [row.user_id]);
    await client.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetPassword(token: string, password: string): Promise<boolean> {
  await ensureAuthSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [digest(token)],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`UPDATE app_users SET password_hash = $1 WHERE id = $2`, [
      await hashPassword(password),
      row.user_id,
    ]);
    await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [
      row.id,
    ]);
    await client.query(`DELETE FROM app_sessions WHERE user_id = $1`, [row.user_id]);
    /*
     * Trocar a senha tem que expulsar o invasor, e apagar `app_sessions`
     * sozinho não fazia isso: o refresh token do app vale 30 dias e vive em
     * outra tabela. Quem trocasse a senha suspeitando de invasão continuava com
     * o atacante dentro, porque `rotateMobileSession` emite access token novo a
     * cada 15 minutos a partir do refresh roubado.
     *
     * Na MESMA transação de propósito: se a revogação falhasse depois do commit
     * da senha, a conta ficaria com senha nova e sessão móvel antiga viva.
     */
    await client.query(
      `UPDATE app_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`,
      [row.user_id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function authCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-finance_session" : "finance_session";
}

export const AUTH_SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
export const ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL_SECONDS;
export const REFRESH_TOKEN_TTL = REFRESH_TOKEN_TTL_SECONDS;

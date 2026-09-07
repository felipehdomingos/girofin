import "server-only";

import {
  createHmac,
  randomBytes,
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

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
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
        CREATE TABLE IF NOT EXISTS app_sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
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
      `)
      .then(() => undefined);
  }
  await schemaReady;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digest(value: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "development-only-secret")
    .update(value)
    .digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

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
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
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
    `INSERT INTO app_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
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
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!authConfigured() || !token) return;
  await ensureAuthSchema();
  await getPool().query(`DELETE FROM app_sessions WHERE token_hash = $1`, [digest(token)]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  if (!authConfigured() || !userId) return;
  await ensureAuthSchema();
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
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
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
    `INSERT INTO app_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
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

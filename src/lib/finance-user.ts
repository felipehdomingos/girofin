import path from "node:path";

import { authConfigured } from "./auth-db";
import { requireCurrentUserId } from "./auth-http";

export function resolveFinanceDbPathForUser(
  userId: string | null | undefined,
  baseDbPath = process.env.FINANCEIRO_DB ?? path.join(process.cwd(), "data", "financeiro.db"),
): string {
  if (!userId || !authConfigured()) {
    return baseDbPath;
  }

  const rootDir = path.dirname(baseDbPath);
  return path.join(rootDir, "users", userId, "financeiro.db");
}

export async function requireFinanceUserScope(): Promise<string> {
  if (!authConfigured()) {
    throw new Error("Sessão financeira não exigida quando a autenticação não está configurada.");
  }

  return requireCurrentUserId();
}

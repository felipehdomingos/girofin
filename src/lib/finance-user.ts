import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { authCookieName, getUserBySession } from "./auth-db";
import { getFinanceUserContext } from "./db";

/**
 * Quem é o dono das consultas financeiras.
 *
 * A sessão do request é a fonte de verdade, e é lida aqui — no momento da
 * consulta — em vez de ser empurrada de fora. O contexto de `db.ts` só entra
 * quando não existe request: testes e scripts rodam o repositório direto no
 * Node e definem o usuário na mão.
 *
 * Era o contrário antes, e não funcionava. `requirePageUser` gravava o usuário
 * num AsyncLocalStorage com `enterWith`, mas só depois de `await currentUser()`
 * — e `enterWith` a partir dali vale para a continuação da própria função, não
 * para a de quem chamou. A page reatava no contexto anterior, sem store, e toda
 * página autenticada morria em "Sessão sem usuário para acesso financeiro".
 *
 * `cache()` dá o escopo de request que a doc do Next indica para a camada de
 * acesso a dados: uma resolução por requisição, compartilhada entre Server
 * Components e Server Actions, sem custar uma consulta de sessão por query.
 */
const sessionUserId = cache(async (): Promise<string | null> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(authCookieName())?.value;
  } catch {
    // Fora de um request não há cookie a ler — `cookies()` lança. É o caminho
    // de teste/script, que cai no contexto explícito logo abaixo.
    return null;
  }
  if (!token) return null;
  return (await getUserBySession(token))?.id ?? null;
});

export async function resolveFinanceUserId(): Promise<string> {
  const userId = (await sessionUserId()) ?? getFinanceUserContext();
  if (!userId) throw new Error("Sessão sem usuário para acesso financeiro.");
  return userId;
}

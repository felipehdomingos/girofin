import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  authCookieName,
  authConfigured,
  AUTH_SESSION_TTL_SECONDS,
  createSession,
  deleteSession,
  getUserBySession,
  getUserByAccessToken,
  revokeAllSessions,
  type AuthUser,
} from "./auth-db";

export { authConfigured };

export async function setAuthSession(userId: string): Promise<void> {
  const token = await createSession(userId);
  const store = await cookies();
  store.set(authCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_TTL_SECONDS,
  });
}

export async function clearAuthSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(authCookieName())?.value;
  if (token) {
    // Sair no navegador derruba só as sessões web — o app no celular continua.
    const user = await getUserBySession(token);
    if (user) await revokeAllSessions(user.id, "web");
    else await deleteSession(token);
  }
  store.delete(authCookieName());
}

export async function currentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  return getUserBySession(store.get(authCookieName())?.value ?? "");
}

export async function currentApiUser(request: Request): Promise<AuthUser | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return getUserByAccessToken(authorization.slice(7).trim());
}

/**
 * Barreira de cada página protegida.
 *
 * Existe porque a checagem no layout de `(app)` não basta: a doc do Next diz
 * que "um layout não controla se o resto da rota renderiza — os segmentos são
 * renderizados pelo router", ou seja, o `redirect()` de lá troca a navegação
 * mas os segmentos filhos já rodaram e o resultado deles vai no RSC Payload.
 * Chamada no topo de cada page, esta função corta antes de qualquer consulta.
 *
 * A condição espelha a do layout: sem autenticação configurada e fora de
 * produção, o modo local de usuário único continua funcionando.
 */
export async function requirePageUser(): Promise<AuthUser | null> {
  const user = await currentUser();
  if (!user && (authConfigured() || process.env.NODE_ENV === "production")) {
    redirect("/login");
  }
  return user;
}

export async function currentUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}

export async function requireCurrentUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) {
    throw new Error("Sessão de usuário ausente para acesso ao repositório financeiro.");
  }
  return userId;
}

import "server-only";

import { cookies } from "next/headers";

import {
  authCookieName,
  AUTH_SESSION_TTL_SECONDS,
  createSession,
  deleteSession,
  getUserBySession,
  type AuthUser,
} from "./auth-db";

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
  if (token) await deleteSession(token);
  store.delete(authCookieName());
}

export async function currentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  return getUserBySession(store.get(authCookieName())?.value ?? "");
}

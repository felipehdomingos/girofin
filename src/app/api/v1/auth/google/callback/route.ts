import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findOrCreateGoogleUser } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";

const STATE_COOKIE = "girofin_google_state";

function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

function fail(request: Request, code: string) {
  return NextResponse.redirect(new URL(`/login?error=${code}`, `${publicOrigin(request)}/`));
}

/** Teto da foto importada. O mesmo que o upload manual aceita. */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Traz a foto da conta Google como data URL.
 *
 * Guardar a URL do Google em vez do binário pareceria mais simples, mas o
 * `/api/v1/me/avatar` serve a partir de data URL, e principalmente: cada
 * exibição da foto viraria uma requisição do navegador do usuário para o
 * Google, contando quando ele usa o app. Baixar uma vez encerra isso.
 *
 * Devolve null em qualquer imprevisto — foto é enfeite, e enfeite não derruba
 * um login que já foi validado.
 */
async function baixarFotoGoogle(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const origem = new URL(url);
    // Só o CDN de foto do Google. Sem isto, um `picture` forjado faria o
    // servidor buscar uma URL arbitrária escolhida de fora (SSRF).
    if (!/(^|\.)googleusercontent\.com$/.test(origem.hostname) || origem.protocol !== "https:") {
      return null;
    }
    const resposta = await fetch(origem, { cache: "no-store" });
    if (!resposta.ok) return null;
    const tipo = resposta.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(tipo)) return null;
    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;
    return `data:${tipo};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value ?? "";
  store.delete(STATE_COOKIE);
  if (!code || !expected || expected.length !== state.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(state))) return fail(request, "google_state");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "google_unavailable");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${publicOrigin(request)}/api/v1/auth/google/callback`;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    if (!tokenResponse.ok) return fail(request, "google_token");
    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (!tokens.id_token) return fail(request, "google_token");
    const profileResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`, { cache: "no-store" });
    if (!profileResponse.ok) return fail(request, "google_profile");
    const profile = (await profileResponse.json()) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string; name?: string; picture?: string };
    if (profile.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(profile.iss ?? "") || profile.email_verified !== "true" || !profile.sub || !profile.email) return fail(request, "google_profile");
    const user = await findOrCreateGoogleUser({
      subject: profile.sub,
      email: profile.email,
      name: profile.name ?? profile.email,
      avatarDataUrl: await baixarFotoGoogle(profile.picture),
    });
    await setAuthSession(user.id);
    return NextResponse.redirect(new URL("/", `${publicOrigin(request)}/`));
  } catch (error) {
    console.error("[auth/google]", error);
    return fail(request, "google_unavailable");
  }
}

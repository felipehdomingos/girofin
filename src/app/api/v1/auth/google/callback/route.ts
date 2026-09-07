import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findOrCreateGoogleUser } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";

const STATE_COOKIE = "girofin_google_state";

function fail(request: Request, code: string) {
  return NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
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
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/v1/auth/google/callback`;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    if (!tokenResponse.ok) return fail(request, "google_token");
    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (!tokens.id_token) return fail(request, "google_token");
    const profileResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`, { cache: "no-store" });
    if (!profileResponse.ok) return fail(request, "google_profile");
    const profile = (await profileResponse.json()) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string; name?: string };
    if (profile.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(profile.iss ?? "") || profile.email_verified !== "true" || !profile.sub || !profile.email) return fail(request, "google_profile");
    const user = await findOrCreateGoogleUser({ subject: profile.sub, email: profile.email, name: profile.name ?? profile.email });
    await setAuthSession(user.id);
    return NextResponse.redirect(new URL("/", request.url));
  } catch (error) {
    console.error("[auth/google]", error);
    return fail(request, "google_unavailable");
  }
}

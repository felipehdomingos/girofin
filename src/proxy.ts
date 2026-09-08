import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SWAGGER_CDN = "https://unpkg.com";

function makeCsp(nonce: string, isDocs: boolean): string {
  const scripts = ["'self'", `'nonce-${nonce}'`];
  const styles = ["'self'", "'unsafe-inline'"];
  if (isDocs) {
    scripts.push(SWAGGER_CDN);
    styles.push(SWAGGER_CDN);
  }
  return [
    "default-src 'self'",
    "img-src 'self' data: https:",
    `style-src ${styles.join(" ")}`,
    `script-src ${scripts.join(" ")}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = makeCsp(nonce, request.nextUrl.pathname === "/api/docs");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};

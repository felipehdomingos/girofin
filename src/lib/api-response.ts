import { NextResponse } from "next/server";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function apiSuccess<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** 429 com `Retry-After`, para o cliente saber quando tentar de novo. */
export function apiRateLimited(retryAfterSeconds = 60) {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      },
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

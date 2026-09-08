import { NextResponse } from "next/server";
import { z } from "zod";

import { resetPassword } from "@/lib/auth-db";
import { apiError, apiRateLimited } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({ token: z.string().min(20).max(300), password: z.string().min(10).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    if (!checkRateLimits([{ rule: AUTH_RATE_RULES.resetIp, identifier: clientIp(request) }])) {
      return apiRateLimited();
    }

    const ok = await resetPassword(body.token, body.password);
    if (!ok) return apiError(400, "INVALID_RESET_TOKEN", "O link de recuperacao expirou ou ja foi utilizado.");
    return NextResponse.json({ message: "Senha redefinida. Entre novamente." });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(400, "INVALID_RESET_INPUT", "Envie um token valido e uma senha com pelo menos 10 caracteres.");
    console.error("[auth/reset-password]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel redefinir sua senha agora. Tente novamente em instantes.");
  }
}

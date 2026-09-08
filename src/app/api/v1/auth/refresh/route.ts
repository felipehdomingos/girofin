import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserByAccessToken, rotateMobileSession } from "@/lib/auth-db";
import { apiError, apiRateLimited, isValidationError } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({ refreshToken: z.string().min(40).max(300) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    if (!checkRateLimits([{ rule: AUTH_RATE_RULES.refreshIp, identifier: clientIp(request) }])) {
      return apiRateLimited();
    }

    const session = await rotateMobileSession(body.refreshToken);
    if (!session) return apiError(401, "INVALID_REFRESH_TOKEN", "Sua sessão móvel expirou ou foi revogada. Faça login novamente.");
    const user = await getUserByAccessToken(session.accessToken);
    if (!user) return apiError(401, "INVALID_REFRESH_TOKEN", "Não foi possível renovar sua sessão. Faça login novamente.");
    return NextResponse.json({ user, ...session });
  } catch (error) {
    if (isValidationError(error)) return apiError(400, "INVALID_REFRESH_INPUT", "Envie um refresh token válido para renovar a sessão.");
    console.error("[auth/refresh]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Não foi possível renovar a sessão agora. Tente novamente em instantes.");
  }
}

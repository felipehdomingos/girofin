import { z } from "zod";

import { authenticateUser, createMobileSession } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";
import { apiError, apiRateLimited, apiSuccess, isValidationError } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clearRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
  client: z.enum(["web", "mobile"]).default("web"),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    /*
     * Limite por IP e por conta alvo. Só por IP não protege a conta (rede
     * distribuída), só por conta não protege a CPU — cada tentativa roda
     * scrypt, que é caro de propósito.
     */
    const allowed = checkRateLimits([
      { rule: AUTH_RATE_RULES.loginIp, identifier: clientIp(request) },
      { rule: AUTH_RATE_RULES.loginEmail, identifier: body.email.toLowerCase() },
    ]);
    if (!allowed) return apiRateLimited();

    const user = await authenticateUser(body.email, body.password);
    if (!user) return apiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");

    /*
     * Credencial correta zera o balde da conta. Sem isso, `loginEmail` virava
     * arma contra terceiro: dez tentativas com o e-mail da vítima travavam a
     * conta dela por uma hora, mesmo com o dono acertando a senha. O balde por
     * IP continua de pé — ele protege a CPU do scrypt e não depende da conta.
     */
    clearRateLimits([{ rule: AUTH_RATE_RULES.loginEmail, identifier: body.email.toLowerCase() }]);

    if (!user.emailVerified) return apiError(403, "EMAIL_NOT_VERIFIED", "Confirme seu e-mail antes de entrar.");
    if (body.client === "mobile") {
      return apiSuccess({ user, ...(await createMobileSession(user.id)) });
    }
    await setAuthSession(user.id);
    return apiSuccess({ user });
  } catch (error) {
    if (isValidationError(error)) {
      return apiError(400, "INVALID_LOGIN_INPUT", "Informe um e-mail valido e uma senha.");
    }
    console.error("[auth/login]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel acessar o servico de login. Tente novamente em instantes.");
  }
}

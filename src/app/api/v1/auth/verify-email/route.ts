import { z } from "zod";

import { verifyEmail } from "@/lib/auth-db";
import { apiError, apiRateLimited, apiSuccess, isValidationError } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    /*
     * Segunda barreira. A primeira é o contador `attempts` no banco, que
     * sobrevive a reinício e a troca de IP; esta corta o volume antes de
     * encostar no Postgres.
     */
    const allowed = checkRateLimits([
      { rule: AUTH_RATE_RULES.verifyIp, identifier: clientIp(request) },
      { rule: AUTH_RATE_RULES.verifyEmailAddress, identifier: body.email.toLowerCase() },
    ]);
    if (!allowed) return apiRateLimited();

    if (!(await verifyEmail(body.email, body.code))) {
      return apiError(400, "INVALID_EMAIL_VERIFICATION", "O código é inválido ou expirou.");
    }
    return apiSuccess({ message: "E-mail confirmado. Agora você já pode entrar." });
  } catch (error) {
    if (isValidationError(error)) return apiError(400, "INVALID_EMAIL_VERIFICATION", "Informe um código de 6 dígitos.");
    console.error("[auth/verify-email]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Não foi possível confirmar o e-mail agora.");
  }
}

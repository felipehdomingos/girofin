import { z } from "zod";

import { createEmailVerification, findUnverifiedUserByEmail } from "@/lib/auth-db";
import { sendEmailVerification } from "@/lib/auth-email";
import { apiError, apiRateLimited, apiSuccess, isValidationError } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().email().max(254) });

/**
 * Reenvio do código de confirmação.
 *
 * Sem esta rota, um envio que falhasse — ou um código expirado, que dura 10
 * minutos — deixava a conta morta: registrar de novo respondia 409, entrar
 * respondia 403 e não havia como pedir outro código.
 *
 * `createEmailVerification` apaga o código anterior não usado, então chamar
 * aqui é idempotente. O contador de tentativas volta a zero junto — por isso a
 * própria função limita quantos códigos um MESMO usuário recebe por hora, e não
 * só quantas vezes este IP chama a rota.
 */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    const allowed = checkRateLimits([
      { rule: AUTH_RATE_RULES.resendEmail, identifier: body.email.toLowerCase() },
      { rule: AUTH_RATE_RULES.verifyIp, identifier: clientIp(request) },
    ]);
    if (!allowed) return apiRateLimited();

    const pending = await findUnverifiedUserByEmail(body.email);
    if (pending) {
      const verification = await createEmailVerification(pending.id);
      /*
       * Dispara e não espera, pelo mesmo motivo de /forgot-password: o envio é
       * uma chamada HTTP ao provedor e só acontece quando há cadastro pendente
       * — esperar por ela deixava o tempo de resposta denunciar o caso.
       * `verification` nulo significa teto de emissões atingido: nada é enviado
       * e a resposta continua a mesma.
       */
      if (verification) {
        void sendEmailVerification(verification).catch((error) =>
          console.error("[auth/resend-verification] envio", error),
        );
      }
    }

    // Resposta igual com ou sem cadastro pendente, para não enumerar contas.
    return apiSuccess({
      message: "Se houver cadastro pendente para este e-mail, enviamos um novo código.",
    });
  } catch (error) {
    if (isValidationError(error)) {
      return apiError(400, "INVALID_EMAIL", "Informe um e-mail válido.");
    }
    console.error("[auth/resend-verification]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Não foi possível reenviar o código agora.");
  }
}

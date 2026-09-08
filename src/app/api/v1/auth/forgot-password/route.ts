import { NextResponse } from "next/server";
import { z } from "zod";

import { createPasswordReset } from "@/lib/auth-db";
import { sendPasswordResetEmail } from "@/lib/auth-email";
import { apiError, apiRateLimited } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().email().max(254) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    /*
     * Por e-mail E por IP. Só por e-mail, cada endereço tinha o próprio balde de
     * 3/h: varrer uma lista inteira de endereços não esbarrava em limite nenhum,
     * porque o atacante nunca repete o mesmo e-mail.
     */
    if (!checkRateLimits([
      { rule: AUTH_RATE_RULES.forgotEmail, identifier: body.email.toLowerCase() },
      { rule: AUTH_RATE_RULES.forgotIp, identifier: clientIp(request) },
    ])) {
      return apiRateLimited();
    }

    const reset = await createPasswordReset(body.email);
    if (reset) {
      /*
       * Dispara e NÃO espera. `sendPasswordResetEmail` é uma chamada HTTP ao
       * provedor e leva centenas de milissegundos; esperar por ela só quando o
       * e-mail existe fazia o TEMPO de resposta separar os dois casos — a
       * mensagem era uniforme, mas o relógio entregava quem tem conta.
       *
       * O erro vira log: quem pediu não pode saber se o envio deu certo, senão
       * o oráculo volta pela porta da frente.
       */
      void sendPasswordResetEmail({
        email: reset.email,
        name: reset.name,
        token: reset.token,
      }).catch((error) => console.error("[auth/forgot-password] envio", error));
    }

    /*
     * O token NUNCA volta no corpo da resposta.
     *
     * Antes ele era devolvido quando `NODE_ENV !== "production"` — o que em
     * qualquer ambiente de desenvolvimento exposto entregava takeover de conta
     * numa requisição. E, como o campo só aparecia quando o e-mail existia,
     * também servia de oráculo de enumeração. Em desenvolvimento o link sai no
     * log do servidor, dentro de `sendPasswordResetEmail`.
     */
    return NextResponse.json({
      message: "Se o e-mail estiver cadastrado, voce recebera as instrucoes de recuperacao.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(400, "INVALID_EMAIL", "Informe um e-mail valido para recuperar a senha.");
    console.error("[auth/forgot-password]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel processar a recuperacao agora. Tente novamente em instantes.");
  }
}

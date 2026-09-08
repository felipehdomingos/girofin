import { z } from "zod";

import {
  createEmailVerification,
  deleteUnverifiedUser,
  findUnverifiedUserByEmail,
  registerUser,
} from "@/lib/auth-db";
import { sendAccountExistsEmail, sendEmailVerification } from "@/lib/auth-email";
import { apiError, apiRateLimited, apiSuccess } from "@/lib/api-response";
import { AUTH_RATE_RULES, checkRateLimits, clientIp } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
});

/**
 * Resposta única para todos os desfechos. Antes o 409 confirmava quais e-mails
 * já tinham conta — enumeração da base inteira com um laço de requisições.
 * Agora quem distingue os casos é o próprio e-mail, que só o dono do endereço
 * recebe.
 */
const UNIFORM_MESSAGE =
  "Se este e-mail puder ser cadastrado, enviamos um código de 6 dígitos para ele.";

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    if (!checkRateLimits([{ rule: AUTH_RATE_RULES.registerIp, identifier: clientIp(request) }])) {
      return apiRateLimited();
    }

    let user;
    try {
      user = await registerUser(body);
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) {
        /*
         * Já existe conta com este e-mail. O dono do endereço precisa saber o
         * que fazer; quem apenas testou o e-mail não pode notar diferença
         * nenhuma na resposta HTTP.
         */
        const pending = await findUnverifiedUserByEmail(body.email);
        if (pending) {
          const verification = await createEmailVerification(pending.id);
          await sendEmailVerification(verification);
        } else {
          await sendAccountExistsEmail({ email: body.email });
        }
        return apiSuccess({ message: UNIFORM_MESSAGE }, 201);
      }
      throw error;
    }

    /*
     * O envio pode falhar (Resend fora do ar, cota, domínio não verificado) e o
     * usuário já está gravado. Sem desfazer, a conta ficava inacessível para
     * sempre: registrar de novo dava 409, entrar dava 403 e não havia reenvio.
     */
    try {
      const verification = await createEmailVerification(user.id);
      await sendEmailVerification(verification);
    } catch (error) {
      await deleteUnverifiedUser(user.id);
      throw error;
    }

    return apiSuccess({ message: UNIFORM_MESSAGE }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(400, "INVALID_REGISTER_INPUT", "Informe nome, e-mail e senha valida para criar sua conta.");
    }
    console.error("[auth/register]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel criar sua conta agora. Tente novamente em instantes.");
  }
}

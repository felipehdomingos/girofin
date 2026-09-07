import { z } from "zod";

import { authenticateUser, createMobileSession } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";
import { apiError, apiSuccess } from "@/lib/api-response";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
  client: z.enum(["web", "mobile"]).default("web"),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await authenticateUser(body.email, body.password);
    if (!user) return apiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
    if (body.client === "mobile") {
      return apiSuccess({ user, ...(await createMobileSession(user.id)) });
    }
    await setAuthSession(user.id);
    return apiSuccess({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(400, "INVALID_LOGIN_INPUT", "Informe um e-mail valido e uma senha.");
    }
    console.error("[auth/login]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel acessar o servico de login. Tente novamente em instantes.");
  }
}

import { z } from "zod";

import { createMobileSession, registerUser } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";
import { apiError, apiSuccess } from "@/lib/api-response";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  client: z.enum(["web", "mobile"]).default("web"),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await registerUser(body);
    if (body.client === "mobile") {
      return apiSuccess({ user, ...(await createMobileSession(user.id)) }, 201);
    }
    await setAuthSession(user.id);
    return apiSuccess({ user }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(400, "INVALID_REGISTER_INPUT", "Informe nome, e-mail e senha valida para criar sua conta.");
    }
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return apiError(409, "EMAIL_ALREADY_REGISTERED", "Este e-mail ja possui uma conta.");
    }
    console.error("[auth/register]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel criar sua conta agora. Tente novamente em instantes.");
  }
}

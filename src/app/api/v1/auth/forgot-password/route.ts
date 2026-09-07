import { NextResponse } from "next/server";
import { z } from "zod";

import { createPasswordReset } from "@/lib/auth-db";
import { apiError } from "@/lib/api-response";

const schema = z.object({ email: z.string().trim().email().max(254) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const reset = await createPasswordReset(body.email);
    const response: { message: string; resetToken?: string } = {
      message: "Se o e-mail estiver cadastrado, voce recebera as instrucoes de recuperacao.",
    };
    if (process.env.NODE_ENV !== "production" && reset) response.resetToken = reset.token;
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(400, "INVALID_EMAIL", "Informe um e-mail valido para recuperar a senha.");
    console.error("[auth/forgot-password]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel processar a recuperacao agora. Tente novamente em instantes.");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { createPasswordReset } from "@/lib/auth-db";
import { sendPasswordResetEmail } from "@/lib/auth-email";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().trim().email().max(254) });
const genericResponse = {
  message: "Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.",
};

export async function POST(request: Request) {
  try {
    const { email } = schema.parse(await request.json());
    const reset = await createPasswordReset(email);
    if (reset) {
      // A resposta continua genérica para não revelar quais e-mails existem.
      await sendPasswordResetEmail(reset);
    }
    return NextResponse.json(genericResponse);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }
    console.error("[auth/forgot-password]", error);
    return NextResponse.json({ error: "Serviço de autenticação indisponível." }, { status: 503 });
  }
}

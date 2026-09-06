import { NextResponse } from "next/server";
import { z } from "zod";

import { resetPassword } from "@/lib/auth-db";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(20).max(300),
  password: z.string().min(10).max(200),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const ok = await resetPassword(body.token, body.password);
    if (!ok) return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 400 });
    return NextResponse.json({ message: "Senha redefinida. Faça login novamente." });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Token ou senha inválidos." }, { status: 400 });
    }
    console.error("[auth/reset-password]", error);
    return NextResponse.json({ error: "Serviço de autenticação indisponível." }, { status: 503 });
  }
}

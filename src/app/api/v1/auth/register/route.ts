import { NextResponse } from "next/server";
import { z } from "zod";

import { registerUser } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await registerUser(body);
    await setAuthSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Dados de cadastro inválidos." }, { status: 400 });
    }
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Não foi possível concluir o cadastro." }, { status: 409 });
    }
    console.error("[auth/register]", error);
    return NextResponse.json({ error: "Serviço de autenticação indisponível." }, { status: 503 });
  }
}

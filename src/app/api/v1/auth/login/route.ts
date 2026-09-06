import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateUser } from "@/lib/auth-db";
import { setAuthSession } from "@/lib/auth-http";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await authenticateUser(body.email, body.password);
    if (!user) return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    await setAuthSession(user.id);
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Informe e-mail e senha válidos." }, { status: 400 });
    }
    console.error("[auth/login]", error);
    return NextResponse.json({ error: "Serviço de autenticação indisponível." }, { status: 503 });
  }
}

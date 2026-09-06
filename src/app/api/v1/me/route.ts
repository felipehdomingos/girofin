import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth-http";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json({ user });
}

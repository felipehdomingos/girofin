import { NextResponse } from "next/server";

import { clearAuthSession } from "@/lib/auth-http";

export async function POST() {
  await clearAuthSession();
  return NextResponse.json({ ok: true });
}

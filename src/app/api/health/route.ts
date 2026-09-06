import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint usado pelo Azure App Service para saber se o processo e o banco
 * local estao respondendo. Nao expoe detalhes de erro nem dados financeiros.
 */
export function GET() {
  try {
    getDb()
      .prepare("SELECT 1 AS ok")
      .get();

    return NextResponse.json({
      ok: true,
      service: "controle-financeiro",
      environment: process.env.APP_ENV ?? "local",
      storage: "sqlite-local",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "controle-financeiro",
      },
      { status: 503 },
    );
  }
}

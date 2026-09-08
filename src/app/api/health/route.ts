import { NextResponse } from "next/server";

import { authConfigured, ensureAuthSchema } from "@/lib/auth-db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint usado pelo Azure App Service para saber se o processo e o banco
 * local estao respondendo. Nao expoe detalhes de erro nem dados financeiros.
 */
export async function GET() {
  try {
    if (authConfigured()) {
      await ensureAuthSchema();
    } else {
      getDb().prepare("SELECT 1 AS ok").get();
    }

    return NextResponse.json({
      ok: true,
      service: "girofin",
      environment: process.env.APP_ENV ?? "local",
      storage: authConfigured() ? "postgres-auth/scoped-finance" : "sqlite-local",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "girofin",
      },
      { status: 503 },
    );
  }
}

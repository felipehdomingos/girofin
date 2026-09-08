import { NextResponse } from "next/server";

import { authConfigured, ensureAuthSchema } from "@/lib/auth-db";
import { pingFinancePostgres } from "@/lib/finance-pg-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint usado pelo Azure App Service para saber se o processo e o
 * PostgreSQL estão respondendo. Não expõe detalhes nem dados financeiros.
 */
export async function GET() {
  try {
    if (authConfigured()) await ensureAuthSchema();
    await pingFinancePostgres();

    return NextResponse.json({
      ok: true,
      service: "girofin",
      environment: process.env.APP_ENV ?? "local",
      storage: "postgres-multiuser-rls",
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

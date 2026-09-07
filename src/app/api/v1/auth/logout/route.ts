import {
  deleteSession,
  revokeAllSessions,
  revokeMobileRefreshToken,
} from "@/lib/auth-db";
import { clearAuthSession, currentApiUser } from "@/lib/auth-http";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function POST(request: Request) {
  try {
    const user = await currentApiUser(request);
    const authorization = request.headers.get("authorization");
    if (user && authorization?.startsWith("Bearer ")) {
      await revokeAllSessions(user.id);
      await deleteSession(authorization.slice(7).trim());
    }
    const rawBody = await request.text();
    if (rawBody) {
      const body = JSON.parse(rawBody) as { refreshToken?: unknown };
      if (typeof body.refreshToken === "string") {
        await revokeMobileRefreshToken(body.refreshToken);
      }
    }
    await clearAuthSession();
    return apiSuccess({ ok: true });
  } catch (error) {
    console.error("[auth/logout]", error);
    return apiError(503, "AUTH_SERVICE_UNAVAILABLE", "Nao foi possivel encerrar a sessao agora. Tente novamente.");
  }
}

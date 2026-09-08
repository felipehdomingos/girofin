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
      // Escopo mobile: não derruba a sessão do navegador do mesmo usuário.
      await revokeAllSessions(user.id, "mobile");
      await deleteSession(authorization.slice(7).trim());
    }
    const rawBody = await request.text();
    if (rawBody) {
      /*
       * Corpo malformado é erro de quem chamou, não do serviço: sem este try o
       * `JSON.parse` estourava até o catch de fora e virava 503, dizendo que a
       * autenticação estava indisponível quando não estava.
       */
      let body: { refreshToken?: unknown };
      try {
        body = JSON.parse(rawBody) as { refreshToken?: unknown };
      } catch {
        // Mesmo recusando o corpo, a sessão do navegador é encerrada: sair
        // nunca pode falhar pela metade e deixar o cookie vivo.
        await clearAuthSession();
        return apiError(400, "INVALID_BODY", "Corpo da requisicao invalido.");
      }
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

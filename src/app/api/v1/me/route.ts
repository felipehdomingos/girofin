import { currentApiUser, currentUser } from "@/lib/auth-http";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(request: Request) {
  const user = (await currentApiUser(request)) ?? (await currentUser());
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sua sessao expirou. Entre novamente.");
  return apiSuccess({ user });
}

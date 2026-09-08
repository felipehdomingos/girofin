import "server-only";

/**
 * Limite de tentativas para a superfície de autenticação.
 *
 * Contador em memória, por processo. Isso cobre o App Service rodando em uma
 * instância — que é o caso hoje. Ao escalar horizontalmente, cada instância
 * passa a contar sozinha e o teto efetivo vira `limite × instâncias`: nesse
 * momento o `hits` abaixo precisa virar tabela no Postgres (ou Redis), mantendo
 * a mesma interface.
 *
 * Não substitui o contador de tentativas do código de confirmação, que vive no
 * banco (`email_verification_tokens.attempts`) justamente para sobreviver a
 * reinício de processo e a troca de IP.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const hits = new Map<string, Bucket>();

/** Evita que o Map cresça sem limite com chaves de janelas já vencidas. */
function sweep(now: number): void {
  if (hits.size < 10_000) return;
  for (const [key, bucket] of hits) {
    if (bucket.resetAt < now) hits.delete(key);
  }
}

/**
 * Consome uma tentativa. Retorna `false` quando o limite da janela estourou.
 */
export function rateLimit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const bucket = hits.get(key);

  if (!bucket || bucket.resetAt < now) {
    sweep(now);
    hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * IP do cliente. Atrás do App Service a origem real vem em `x-forwarded-for`;
 * o primeiro item é o cliente e o resto são os proxies do caminho.
 *
 * O cabeçalho é falsificável por quem fala direto com a aplicação, então isto
 * sozinho não é defesa — por isso todo endpoint aqui limita também pela conta
 * alvo, que o atacante não escolhe livremente.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "desconhecido";
}

export interface RateRule {
  /** Sufixo que separa os contadores de endpoints diferentes. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Aplica as regras em sequência e devolve a primeira que estourou.
 * Todas são consumidas antes do retorno — parar na primeira deixaria as
 * seguintes sem contar as tentativas que já aconteceram.
 */
export function checkRateLimits(
  entries: Array<{ rule: RateRule; identifier: string }>,
): boolean {
  let allowed = true;
  for (const { rule, identifier } of entries) {
    const ok = rateLimit(`${rule.scope}:${identifier}`, rule.limit, rule.windowSeconds);
    if (!ok) allowed = false;
  }
  return allowed;
}

export const AUTH_RATE_RULES = {
  loginIp: { scope: "login:ip", limit: 5, windowSeconds: 60 },
  loginEmail: { scope: "login:email", limit: 10, windowSeconds: 60 * 60 },
  registerIp: { scope: "register:ip", limit: 5, windowSeconds: 60 * 60 },
  forgotEmail: { scope: "forgot:email", limit: 3, windowSeconds: 60 * 60 },
  resetIp: { scope: "reset:ip", limit: 10, windowSeconds: 60 * 60 },
  verifyEmailAddress: { scope: "verify:email", limit: 10, windowSeconds: 60 * 60 },
  verifyIp: { scope: "verify:ip", limit: 30, windowSeconds: 60 * 60 },
  resendEmail: { scope: "resend:email", limit: 3, windowSeconds: 60 * 60 },
  refreshIp: { scope: "refresh:ip", limit: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateRule>;

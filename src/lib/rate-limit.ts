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
 * banco (`email_verification_tokens.attempts`) nem o teto de emissões por
 * usuário (`app_users.email_verification_sends`) — os dois estão no Postgres
 * justamente para sobreviver a reinício de processo e a troca de IP.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const hits = new Map<string, Bucket>();

/**
 * Teto rígido de baldes vivos, e quantos são descartados quando ele é atingido.
 *
 * O `sweep` antigo só removia balde VENCIDO. Com janelas de uma hora e chave
 * nova a cada requisição (o que era trivial antes da correção do `clientIp`), o
 * mapa enchia de entradas todas vigentes: a varredura não apagava nada e rodava
 * inteira a cada chave nova — O(N²) de CPU num processo single-threaded, a
 * partir de endpoint não autenticado.
 */
const MAX_BUCKETS = 20_000;
const EVICTION_BATCH = 2_000;

/**
 * Garante espaço antes de inserir. Roda só quando o mapa está cheio e, quando
 * roda, libera um lote inteiro — assim a varredura O(N) é amortizada em
 * `EVICTION_BATCH` inserções, em vez de acontecer a cada uma.
 *
 * O descarte é por ordem de inserção (o Map preserva). Descartar balde vigente
 * perdoa o contador de quem foi despejado, mas o alvo do despejo são as chaves
 * MAIS ANTIGAS — e o limitador de memória existe justamente para o caso em que
 * a alternativa é o processo cair.
 */
function makeRoom(now: number): void {
  if (hits.size < MAX_BUCKETS) return;

  for (const [key, bucket] of hits) {
    if (bucket.resetAt < now) hits.delete(key);
  }
  if (hits.size < MAX_BUCKETS) return;

  let restantes = EVICTION_BATCH;
  for (const key of hits.keys()) {
    hits.delete(key);
    if (--restantes <= 0) break;
  }
}

/**
 * Consome uma tentativa. Retorna `false` quando o limite da janela estourou.
 */
export function rateLimit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const bucket = hits.get(key);

  if (!bucket || bucket.resetAt < now) {
    makeRoom(now);
    hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Devolve o balde ao estado zerado. Ver `clearRateLimits`. */
export function clearRateLimit(key: string): void {
  hits.delete(key);
}

/**
 * IP do cliente, a partir do ÚLTIMO elemento de `x-forwarded-for`.
 *
 * Isso depende da plataforma: o alvo do deploy é o Azure App Service, que
 * ACRESCENTA o IP real ao final da cadeia — logo o último item é o único hop
 * que a plataforma escreveu, e os anteriores vieram do cliente. Lendo o
 * PRIMEIRO, como antes, bastava mandar `X-Forwarded-For: <aleatório>` para ter
 * chave nova a cada requisição: `loginIp`, `registerIp`, `resetIp`, `verifyIp` e
 * `refreshIp` deixavam de existir como limite.
 *
 * Atrás de outro proxy (nginx, Cloudflare) a convenção pode ser a oposta — se o
 * deploy mudar, este é o ponto a revisar.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return stripPort(last);
  }
  return stripPort(request.headers.get("x-real-ip")?.trim() ?? "") || "desconhecido";
}

/**
 * Remove a porta que o App Service costuma anexar ("187.1.2.3:52341"). Sem
 * isso, cada conexão nova do mesmo IP viraria uma chave diferente — e o limite
 * por IP não limitaria nada.
 */
function stripPort(value: string): string {
  if (value.startsWith("[")) {
    // IPv6 entre colchetes: "[::1]:443".
    const close = value.indexOf("]");
    return close > 0 ? value.slice(1, close) : value;
  }
  // Dois-pontos único = IPv4 com porta. Vários = IPv6 puro, que fica inteiro.
  const first = value.indexOf(":");
  if (first > -1 && first === value.lastIndexOf(":")) return value.slice(0, first);
  return value;
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

/**
 * Zera os baldes das regras indicadas.
 *
 * Existe para o login bem-sucedido: `loginEmail` é consumido ANTES de saber se
 * a senha estava certa, então dez POSTs com o e-mail da vítima e senha qualquer
 * esgotavam a janela e o dono legítimo levava 429 pela hora seguinte. Zerando
 * no acerto, o balde só acumula tentativa ERRADA — que é o que ele deveria
 * contar. Quem acerta a senha não é quem o limite persegue.
 */
export function clearRateLimits(
  entries: Array<{ rule: RateRule; identifier: string }>,
): void {
  for (const { rule, identifier } of entries) {
    clearRateLimit(`${rule.scope}:${identifier}`);
  }
}

export const AUTH_RATE_RULES = {
  loginIp: { scope: "login:ip", limit: 5, windowSeconds: 60 },
  loginEmail: { scope: "login:email", limit: 10, windowSeconds: 60 * 60 },
  registerIp: { scope: "register:ip", limit: 5, windowSeconds: 60 * 60 },
  forgotEmail: { scope: "forgot:email", limit: 3, windowSeconds: 60 * 60 },
  /*
   * Sem limite por IP, cada endereço tinha o próprio balde de 3/h e uma lista
   * inteira de e-mails era varrível de uma vez — o limite por e-mail não custa
   * nada a quem testa mil endereços diferentes.
   */
  forgotIp: { scope: "forgot:ip", limit: 10, windowSeconds: 60 * 60 },
  resetIp: { scope: "reset:ip", limit: 10, windowSeconds: 60 * 60 },
  verifyEmailAddress: { scope: "verify:email", limit: 10, windowSeconds: 60 * 60 },
  verifyIp: { scope: "verify:ip", limit: 30, windowSeconds: 60 * 60 },
  resendEmail: { scope: "resend:email", limit: 3, windowSeconds: 60 * 60 },
  refreshIp: { scope: "refresh:ip", limit: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateRule>;

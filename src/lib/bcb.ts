import "server-only";

import { getFinancePgDb } from "./finance-pg-db";

/**
 * Taxas reais do Banco Central, via API pública SGS.
 * Doc: https://dadosabertos.bcb.gov.br/dataset/taxas-de-juros
 *
 * Estratégia de resiliência em três camadas, porque a API do BCB cai:
 *   1. cache no PostgreSQL (12h)  -> caso normal, zero rede
 *   2. fetch na API                -> quando o cache vence
 *   3. constante de emergência     -> quando a API falha E não há cache
 *
 * A camada usada é devolvida em `stale`/`source` para a UI poder DIZER ao
 * usuário que número ele está vendo. Mostrar taxa desatualizada como se fosse
 * ao vivo, numa ferramenta de decisão financeira, é pior do que não mostrar.
 */

/** Códigos das séries no SGS. */
const SERIES = {
  /** Meta Selic definida pelo Copom, % a.a. */
  SELIC: "432",
  /** CDI acumulado no dia, anualizado base 252, % a.a. */
  CDI: "4389",
  /** IPCA, variação % no mês (acumulamos 12 para chegar no ano). */
  IPCA: "433",
} as const;

/**
 * Valores de emergência. Só aparecem quando a API está fora E o cache vazio —
 * e nesse caso a UI marca explicitamente como estimativa.
 */
const FALLBACK: Record<keyof typeof SERIES, number> = {
  SELIC: 15,
  CDI: 14.9,
  IPCA: 4.5,
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface RateInfo {
  /** % ao ano. */
  annualPct: number;
  /** Data de referência do dado no BCB. */
  refDate: string;
  /** De onde veio o número que está na tela. */
  source: "api" | "cache" | "fallback";
}

export interface Rates {
  selic: RateInfo;
  cdi: RateInfo;
  ipca: RateInfo;
}

interface SgsPoint {
  data: string;
  valor: string;
}

/** "01/09/2026" -> "2026-09-01" */
function brToIso(br: string): string {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
}

async function fetchSeries(code: string, last: number): Promise<SgsPoint[]> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${last}?formato=json`;

  // Timeout explícito: sem isso, um BCB lento trava o render da página inteira.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      // A série muda no máximo uma vez por dia; não faz sentido revalidar a cada request.
      next: { revalidate: 60 * 60 * 6 },
    });
    if (!res.ok) throw new Error(`BCB respondeu ${res.status}`);
    return (await res.json()) as SgsPoint[];
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(series: string): Promise<{ annualPct: number; refDate: string; fetchedAt: string | Date } | null> {
  const row = await getFinancePgDb()
    .prepare(`SELECT annualPct, refDate, fetchedAt FROM rate_cache WHERE series = ?`)
    .get(series) as
    | { annualPct: number; refDate: string; fetchedAt: string | Date }
    | undefined;
  return row ?? null;
}

async function writeCache(series: string, annualPct: number, refDate: string): Promise<void> {
  await getFinancePgDb()
    .prepare(
      `INSERT INTO rate_cache (series, annualPct, refDate, fetchedAt)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(series) DO UPDATE SET
         annualPct = excluded.annualPct,
         refDate   = excluded.refDate,
         fetchedAt = excluded.fetchedAt`,
    )
    .run(series, annualPct, refDate);
}

function isFresh(fetchedAt: string | Date): boolean {
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(fetchedAt);
  return Number.isFinite(t) && Date.now() - t < CACHE_TTL_MS;
}

/**
 * Uma série. `annualize` converte o payload bruto em % ao ano — o IPCA vem
 * mensal e precisa de composição de 12 meses, as taxas de juros já vêm anuais.
 */
async function getRate(
  key: keyof typeof SERIES,
  points: number,
  annualize: (values: number[]) => number,
): Promise<RateInfo> {
  const code = SERIES[key];
  const cached = await readCache(code);

  if (cached && isFresh(cached.fetchedAt)) {
    return { annualPct: cached.annualPct, refDate: cached.refDate, source: "cache" };
  }

  try {
    const data = await fetchSeries(code, points);
    if (data.length === 0) throw new Error("série vazia");

    const values = data.map((p) => Number(p.valor.replace(",", ".")));
    if (values.some((v) => !Number.isFinite(v))) throw new Error("valor inválido");

    const annualPct = annualize(values);
    const refDate = brToIso(data[data.length - 1].data);
    await writeCache(code, annualPct, refDate);
    return { annualPct, refDate, source: "api" };
  } catch {
    // Cache vencido ainda é melhor que constante chutada.
    if (cached) {
      return { annualPct: cached.annualPct, refDate: cached.refDate, source: "cache" };
    }
    return { annualPct: FALLBACK[key], refDate: "", source: "fallback" };
  }
}

export async function getRates(): Promise<Rates> {
  // Em paralelo: três séries independentes, nada ganha em serializar.
  const [selic, cdi, ipca] = await Promise.all([
    getRate("SELIC", 1, (v) => v[v.length - 1]),
    getRate("CDI", 1, (v) => v[v.length - 1]),
    // IPCA vem como variação mensal em %. O acumulado do ano é o produto dos
    // fatores mensais, não a soma — somar subestima por ignorar a composição.
    getRate("IPCA", 12, (v) =>
      (v.reduce((acc, m) => acc * (1 + m / 100), 1) - 1) * 100,
    ),
  ]);

  return { selic, cdi, ipca };
}

/**
 * Rendimento da poupança pela regra vigente (Lei 12.703/2012):
 *   Selic > 8,5% a.a.  -> 0,5% a.m. + TR  (teto: na prática ~6,17% a.a.)
 *   Selic <= 8,5% a.a. -> 70% da Selic + TR
 * TR tratada como zero, que é o valor praticado na maior parte do período recente.
 */
export function poupancaAnnualPct(selicAnnualPct: number): number {
  if (selicAnnualPct > 8.5) {
    return (Math.pow(1.005, 12) - 1) * 100; // ≈ 6,17% a.a.
  }
  return selicAnnualPct * 0.7;
}

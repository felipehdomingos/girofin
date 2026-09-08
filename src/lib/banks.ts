import "server-only";

import { getFinancePgDb } from "./finance-pg-db";

/**
 * Lista de bancos brasileiros, da BrasilAPI (dados do Banco Central).
 * https://brasilapi.com.br/api/banks/v1
 *
 * Traz 476 instituições com ISPB, código COMPE, nome e — o que importa aqui —
 * `logo_url` apontando para SVGs num CDN público. É isso que permite mostrar o
 * logo de verdade em vez de um quadradinho colorido.
 *
 * Mesma estratégia de resiliência das taxas do BCB: cache local primeiro, API
 * depois, lista mínima embutida como último recurso. Cadastrar um banco não
 * pode depender de a internet estar boa.
 */

export interface Bank {
  ispb: string;
  /** Código COMPE (001, 341, 260...). null em instituições que não têm. */
  code: number | null;
  name: string;
  fullName: string;
  logoUrl: string | null;
}

/** 30 dias: a lista de bancos muda algumas vezes por ano, não por dia. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_KEY = "banks-brasilapi";

/**
 * Os bancos mais usados, embutidos. Só aparecem quando a API está fora E não há
 * cache — melhor um punhado de opções que uma tela de cadastro travada.
 */
const FALLBACK: Bank[] = [
  { ispb: "00000000", code: 1, name: "BCO DO BRASIL S.A.", fullName: "Banco do Brasil S.A.", logoUrl: logoFor("00000000") },
  { ispb: "60746948", code: 237, name: "BCO BRADESCO S.A.", fullName: "Banco Bradesco S.A.", logoUrl: logoFor("60746948") },
  { ispb: "60701190", code: 341, name: "ITAÚ UNIBANCO S.A.", fullName: "Itaú Unibanco S.A.", logoUrl: logoFor("60701190") },
  { ispb: "90400888", code: 33, name: "BCO SANTANDER (BRASIL) S.A.", fullName: "Banco Santander (Brasil) S.A.", logoUrl: logoFor("90400888") },
  { ispb: "00360305", code: 104, name: "CAIXA ECONOMICA FEDERAL", fullName: "Caixa Econômica Federal", logoUrl: logoFor("00360305") },
  { ispb: "18236120", code: 260, name: "NU PAGAMENTOS - IP", fullName: "Nu Pagamentos S.A.", logoUrl: logoFor("18236120") },
  { ispb: "00416968", code: 77, name: "BANCO INTER", fullName: "Banco Inter S.A.", logoUrl: logoFor("00416968") },
  { ispb: "31872495", code: 336, name: "BCO C6 S.A.", fullName: "Banco C6 S.A.", logoUrl: logoFor("31872495") },
  { ispb: "13203354", code: 623, name: "BANCO PAN", fullName: "Banco Pan S.A.", logoUrl: logoFor("13203354") },
  { ispb: "22896431", code: 290, name: "PAGSEGURO S.A.", fullName: "PagSeguro Internet IP S.A.", logoUrl: logoFor("22896431") },
  { ispb: "10573521", code: 323, name: "MERCADO PAGO IP LTDA.", fullName: "Mercado Pago Instituição de Pagamento Ltda.", logoUrl: logoFor("10573521") },
  { ispb: "02332886", code: 102, name: "XP INVESTIMENTOS CCTVM S/A", fullName: "XP Investimentos CCTVM S.A.", logoUrl: logoFor("02332886") },
];

function logoFor(ispb: string): string {
  return `https://cdn.jsdelivr.net/npm/logos-bancos-br@0/logos/svg/${ispb}.svg`;
}

interface BrasilApiBank {
  ispb: string;
  code: number | null;
  name: string;
  fullName: string;
  logo_url?: string | null;
}

/**
 * A lista de bancos, ordenada pelos mais conhecidos primeiro.
 *
 * Nunca lança: qualquer falha cai no cache ou no fallback. A tela de cadastro
 * sempre tem o que mostrar.
 */
export async function getBanks(): Promise<{ banks: Bank[]; source: "api" | "cache" | "fallback" }> {
  const cached = await readCache();
  if (cached && isFresh(cached.fetchedAt)) {
    return { banks: cached.banks, source: "cache" };
  }

  try {
    // Timeout explícito: BrasilAPI lenta não pode travar o render da página.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let raw: BrasilApiBank[];
    try {
      const res = await fetch("https://brasilapi.com.br/api/banks/v1", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        next: { revalidate: 60 * 60 * 24 * 7 },
      });
      if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
      raw = (await res.json()) as BrasilApiBank[];
    } finally {
      clearTimeout(timer);
    }

    const banks = raw
      // Entradas sem código COMPE são câmaras de liquidação e afins (Selic,
      // Bacen) — não são banco onde alguém tem conta.
      .filter((b) => b.code !== null && b.ispb)
      .map(
        (b): Bank => ({
          ispb: b.ispb,
          code: b.code,
          name: b.name,
          fullName: b.fullName ?? b.name,
          logoUrl: b.logo_url ?? null,
        }),
      )
      .sort(byRelevance);

    if (banks.length === 0) throw new Error("lista vazia");

    await writeCache(banks);
    return { banks, source: "api" };
  } catch {
    if (cached) return { banks: cached.banks, source: "cache" };
    return { banks: FALLBACK, source: "fallback" };
  }
}

/**
 * Ordena por relevância prática, não alfabética.
 *
 * Numa lista alfabética de 476 instituições, o Itaú fica depois de dezenas de
 * cooperativas que ninguém procura. Quem tem logo aparece antes (sinal de
 * banco de varejo), e os grandes vêm fixados no topo.
 */
const DESTAQUE = [
  "00000000", "60701190", "60746948", "90400888", "00360305",
  "18236120", "00416968", "31872495", "10573521", "22896431",
];

function byRelevance(a: Bank, b: Bank): number {
  const ia = DESTAQUE.indexOf(a.ispb);
  const ib = DESTAQUE.indexOf(b.ispb);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  const la = a.logoUrl ? 0 : 1;
  const lb = b.logoUrl ? 0 : 1;
  if (la !== lb) return la - lb;
  return a.name.localeCompare(b.name, "pt-BR");
}

// ------------------------------------------------------------------ cache

interface CacheRow {
  banks: Bank[];
  fetchedAt: string | Date;
}

async function readCache(): Promise<CacheRow | null> {
  try {
    const row = await getFinancePgDb()
      .prepare(`SELECT payload, fetchedAt FROM bank_cache WHERE cacheKey = ?`)
      .get(CACHE_KEY) as
      | { payload: Bank[]; fetchedAt: string | Date }
      | undefined;
    if (!row) return null;
    // Reaproveita a tabela de cache: `refDate` guarda o JSON da lista. Criar
    // uma tabela só para isso seria schema a mais para o mesmo comportamento.
    return { banks: row.payload, fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

async function writeCache(banks: Bank[]): Promise<void> {
  try {
    await getFinancePgDb()
      .prepare(
        `INSERT INTO bank_cache (cacheKey, payload, fetchedAt)
         VALUES (?, ?::jsonb, now())
         ON CONFLICT(cacheKey) DO UPDATE SET
           payload = excluded.payload, fetchedAt = excluded.fetchedAt`,
      )
      .run(CACHE_KEY, JSON.stringify(banks));
  } catch {
    // Cache é otimização, não requisito. Falhar aqui não pode derrubar a tela.
  }
}

function isFresh(fetchedAt: string | Date): boolean {
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(fetchedAt);
  return Number.isFinite(t) && Date.now() - t < CACHE_TTL_MS;
}

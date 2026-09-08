import "server-only";

import { getFinancePgDb } from "./finance-pg-db";
import { parseBRLToCents } from "./money";
import { today } from "./dates";
import type { Category, PaymentMethod, TxNature, TxType } from "./types";

/**
 * CategorizaÃ§Ã£o automÃ¡tica do lanÃ§amento diÃ¡rio.
 *
 * Roda 100% local e determinÃ­stico â€” sem chamada a API de IA. TrÃªs motivos:
 * lanÃ§ar gasto Ã© operaÃ§Ã£o de todo dia e nÃ£o pode depender de rede; extrato
 * financeiro Ã© dado sensÃ­vel e nÃ£o precisa sair da mÃ¡quina; e o mesmo texto
 * tem que cair sempre na mesma categoria, senÃ£o o histÃ³rico fica incomparÃ¡vel.
 *
 * O acerto vem de duas fontes: um vocabulÃ¡rio embutido de marcas e termos reais
 * (ver seedRules em db.ts) e as regras APRENDIDAS quando vocÃª corrige um palpite.
 * Corrigir uma vez ensina para sempre.
 */

export interface Guess {
  categoryId: string | null;
  /** 0-1. Abaixo de 0.5 a UI pede confirmaÃ§Ã£o em vez de assumir. */
  confidence: number;
  /** Qual palavra disparou o palpite â€” a UI mostra isso para vocÃª poder discordar. */
  matchedKeyword: string | null;
}

/**
 * Normaliza para comparar: minÃºsculas, sem acento, sem pontuaÃ§Ã£o.
 * "Padaria SÃ£o JoÃ£o" e "padaria sao joao" tÃªm que colidir.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface RuleRow {
  keyword: string;
  categoryId: string;
  source: "seed" | "learned";
  hits: number;
}

export async function guessCategory(description: string): Promise<Guess> {
  const text = normalize(description);
  if (!text) return { categoryId: null, confidence: 0, matchedKeyword: null };

  const rules = await getFinancePgDb()
    .prepare(`SELECT keyword, categoryId, source, hits FROM category_rules`)
    .all() as unknown as RuleRow[];

  let best: { rule: RuleRow; score: number } | null = null;

  for (const rule of rules) {
    const kw = rule.keyword;
    let score = 0;

    if (text === kw) {
      score = 1; // texto idÃªntico Ã  regra
    } else if (wordBoundaryRegex(kw).test(text)) {
      // Palavra inteira. Fronteira \b evita que "gas" case dentro de "gastos".
      score = 0.85;
    } else if (kw.length >= 5 && text.includes(kw)) {
      // Substring sÃ³ para chaves longas o bastante para nÃ£o gerar falso positivo.
      score = 0.6;
    } else {
      continue;
    }

    // Regra que vocÃª ensinou vale mais que a embutida: ela reflete o SEU vocabulÃ¡rio.
    if (rule.source === "learned") score += 0.1;
    // Desempate por uso: a que jÃ¡ acertou mais vezes ganha, com teto baixo
    // para o histÃ³rico nÃ£o sequestrar um match textual melhor.
    score += Math.min(rule.hits, 20) * 0.002;
    // Chave mais longa Ã© mais especÃ­fica: "mercado livre" ganha de "mercado".
    score += kw.length * 0.001;

    if (!best || score > best.score) best = { rule, score };
  }

  if (!best) return { categoryId: null, confidence: 0, matchedKeyword: null };

  return {
    categoryId: best.rule.categoryId,
    confidence: Math.min(best.score, 1),
    matchedKeyword: best.rule.keyword,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cache do regex de palavra inteira, por keyword.
 *
 * `guessCategory` roda uma vez por LINHA do lanÃ§amento em lote e o laÃ§o percorre
 * a tabela de regras inteira â€” compilar o mesmo `RegExp` dentro do laÃ§o era
 * `linhas Ã— regras` compilaÃ§Ãµes por chamada. As chaves vÃªm da tabela de regras,
 * que Ã© finita e escrita pelo prÃ³prio app, entÃ£o o mapa nÃ£o cresce sem controle.
 */
const boundaryCache = new Map<string, RegExp>();

function wordBoundaryRegex(keyword: string): RegExp {
  let regex = boundaryCache.get(keyword);
  if (!regex) {
    regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`);
    boundaryCache.set(keyword, regex);
  }
  return regex;
}

/**
 * Aprende com uma correÃ§Ã£o. Guarda o termo mais informativo da descriÃ§Ã£o
 * (a palavra mais longa, ignorando ruÃ­do) apontando para a categoria certa.
 */
export async function learnFromCorrection(description: string, categoryId: string): Promise<void> {
  const text = normalize(description);
  if (!text) return;

  const STOPWORDS = new Set([
    "de", "da", "do", "para", "com", "em", "no", "na", "o", "a", "e", "um",
    "uma", "por", "pix", "pagamento", "compra", "conta",
  ]);

  const token = text
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length)[0];

  if (!token) return;

  await getFinancePgDb()
    .prepare(
      `INSERT INTO category_rules (keyword, categoryId, source, hits, updatedAt)
       VALUES (?, ?, 'learned', 1, datetime('now'))
       ON CONFLICT(user_id, keyword) DO UPDATE SET
         categoryId = excluded.categoryId,
         source     = 'learned',
         hits       = category_rules.hits + 1,
         updatedAt  = datetime('now')`,
    )
    .run(token, categoryId);
}

/** Confirma que o palpite estava certo â€” reforÃ§a a regra sem criar nova. */
export async function reinforce(keyword: string): Promise<void> {
  await getFinancePgDb()
    .prepare(`UPDATE category_rules SET hits = hits + 1 WHERE keyword = ?`)
    .run(keyword);
}

// ------------------------------------------------------- lanÃ§amento em lote

export interface ParsedEntry {
  description: string;
  /** Em PARCELADO, Ã© o TOTAL da compra (parcela Ã— nÃºmero de parcelas). */
  amountCents: number;
  type: TxType;
  nature: TxNature;
  /** NÃºmero de parcelas quando nature === "PARCELADO". */
  installments: number | null;
  /** Forma de pagamento detectada no texto ("pix", "debito"...). */
  method: PaymentMethod | null;
  categoryId: string | null;
  categoryName: string | null;
  confidence: number;
  matchedKeyword: string | null;
  /** Linha original, para vocÃª conferir o que foi interpretado. */
  raw: string;
}

/**
 * Interpreta o texto do dia inteiro de uma vez.
 *
 * Aceita o jeito que a pessoa realmente escreve, uma despesa por linha ou
 * separadas por vÃ­rgula/ponto-e-vÃ­rgula:
 *
 *     mercado 152,30
 *     uber 28
 *     ifood 45,90; netflix 39,90
 *     +salario 5400          <- o "+" marca entrada
 *
 * O valor Ã© o Ãºltimo nÃºmero da linha; o resto Ã© a descriÃ§Ã£o. Essa ordem Ã© a
 * natural em portuguÃªs ("uber 28"), e aceitar o valor no meio abriria margem
 * para interpretar errado descriÃ§Ãµes que contÃªm nÃºmero ("99 pop 18").
 */
/** Comprimento mÃ¡ximo de uma linha do lanÃ§amento em lote. Ver o filtro abaixo. */
const MAX_LINE_CHARS = 400;

export async function parseBulk(input: string, categories: Category[]): Promise<ParsedEntry[]> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const lines = input
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length <= MAX_LINE_CHARS)
    .flatMap((line) => splitOnCommaIfSafe(line));

  const entries = await Promise.all(lines.map(async (raw): Promise<ParsedEntry | null> => {
    const line = raw.trim();
    if (!line) return null;
    const isIncome = line.startsWith('+');
    const body = isIncome ? line.slice(1).trim() : line;
    const semMetodo = extractMethod(body);
    const parcelado = extractInstallments(semMetodo.description);
    if (!parcelado || !parcelado.description) return null;
    const guess = await guessCategory(parcelado.description);
    const category = guess.categoryId ? byId.get(guess.categoryId) : undefined;
    return {
      description: parcelado.description,
      amountCents: parcelado.amountCents,
      type: isIncome ? 'INCOME' : 'EXPENSE',
      nature: parcelado.installments ? 'PARCELADO' : 'VISTA',
      installments: parcelado.installments,
      method: semMetodo.method,
      categoryId: guess.categoryId,
      categoryName: category?.name ?? null,
      confidence: guess.confidence,
      matchedKeyword: guess.matchedKeyword,
      raw: line,
    };
  }));
  return entries.filter((entry): entry is ParsedEntry => entry !== null);
}
/**
 * Extrai descriÃ§Ã£o, valor e nÃºmero de parcelas de uma linha.
 *
 * As duas formas que as pessoas escrevem de fato, ambas aceitas porque a
 * posiÃ§Ã£o do "Nx" jÃ¡ desfaz a ambiguidade sozinha:
 *
 *   "tenis 380 4x"   -> 380 Ã© o TOTAL, dividido em 4 (parcelas de 95)
 *   "tenis 4x 95"    -> 95 Ã© a PARCELA, total 380
 *   "tenis 380"      -> Ã  vista
 *
 * A regra Ã© posicional: "Nx" DEPOIS do valor lÃª o valor como total; "Nx" ANTES
 * do valor lÃª como "N vezes de". Ã‰ como se fala â€” "380 em 4x" x "4x de 95".
 */
function extractInstallments(body: string): {
  description: string;
  amountCents: number;
  installments: number | null;
} | null {
  // Forma 1: "<desc> <valor> <N>x"
  const totalFirst = body.match(/^(.*?)\s*([\d.,]+)\s*(?:em\s*)?(\d{1,2})\s*x\s*$/i);
  if (totalFirst) {
    const cents = parseBRLToCents(totalFirst[2]);
    const parts = Number(totalFirst[3]);
    if (cents !== null && cents > 0 && parts >= 2) {
      return {
        description: cleanDescription(totalFirst[1]),
        amountCents: cents,
        installments: parts,
      };
    }
  }

  // Forma 2: "<desc> <N>x <valor>"  (o valor Ã© o da parcela)
  const partsFirst = body.match(/^(.*?)\s*(\d{1,2})\s*x\s*(?:de\s*)?([\d.,]+)\s*$/i);
  if (partsFirst) {
    const perPart = parseBRLToCents(partsFirst[3]);
    const parts = Number(partsFirst[2]);
    if (perPart !== null && perPart > 0 && parts >= 2) {
      return {
        description: cleanDescription(partsFirst[1]),
        // O resto do sistema sÃ³ lida com o total da compra.
        amountCents: perPart * parts,
        installments: parts,
      };
    }
  }

  // Ã€ vista: o valor Ã© o Ãºltimo nÃºmero da linha.
  const plain = body.match(/(-?[\d.,]+)\s*$/);
  if (!plain) return null;

  const cents = parseBRLToCents(plain[1]);
  if (cents === null || cents <= 0) return null;

  return {
    description: cleanDescription(body.slice(0, plain.index)),
    amountCents: cents,
    installments: null,
  };
}

function cleanDescription(text: string): string {
  return text.replace(/[-â€“â€”:]\s*$/, "").trim();
}

/**
 * Palavras que indicam a forma de pagamento no texto livre.
 * Escrever "mercado 152,30 pix" Ã© mais rÃ¡pido que abrir um select â€” e Ã© como
 * a pessoa fala.
 */
const METHOD_WORDS: Array<[RegExp, PaymentMethod]> = [
  [/\bpix\b/i, "PIX"],
  [/\b(debito|dÃ©bito|deb)\b/i, "DEBITO"],
  [/\b(credito|crÃ©dito|cred|cartao|cartÃ£o)\b/i, "CREDITO"],
  [/\b(dinheiro|especie|espÃ©cie|cash)\b/i, "DINHEIRO"],
  [/\bboleto\b/i, "BOLETO"],
  [/\b(transferencia|transferÃªncia|ted|doc)\b/i, "TRANSFERENCIA"],
];

/**
 * Extrai a forma de pagamento e a REMOVE da descriÃ§Ã£o.
 *
 * Deixar a palavra na descriÃ§Ã£o estragaria duas coisas: o histÃ³rico ficaria
 * cheio de "mercado pix" em vez de "mercado", e o categorizador aprenderia
 * "pix" como se fosse nome de estabelecimento.
 */
function extractMethod(text: string): {
  description: string;
  method: PaymentMethod | null;
} {
  for (const [re, method] of METHOD_WORDS) {
    if (re.test(text)) {
      return { description: text.replace(re, " ").replace(/\s+/g, " ").trim(), method };
    }
  }
  return { description: text, method: null };
}

/**
 * VÃ­rgula Ã© ambÃ­gua em portuguÃªs: separa itens ("uber 28, ifood 45") e tambÃ©m
 * Ã© o decimal ("28,50"). SÃ³ quebramos quando os dois lados tÃªm letra â€” o que
 * indica descriÃ§Ãµes distintas, nÃ£o um nÃºmero partido ao meio.
 */
function splitOnCommaIfSafe(line: string): string[] {
  if (!line.includes(",")) return [line];

  const parts: string[] = [];
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ",") {
      const before = line[i - 1];
      const after = line[i + 1];
      // dÃ­gito,dÃ­gito => decimal, mantÃ©m junto
      if (/\d/.test(before ?? "") && /\d/.test(after ?? "")) {
        current += ch;
        continue;
      }
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Data padrÃ£o de um lanÃ§amento rÃ¡pido: hoje. */
export function defaultEntryDate(): string {
  return today();
}


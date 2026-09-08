import "server-only";

import { getDb } from "./db";
import { parseBRLToCents } from "./money";
import { today } from "./dates";
import type { Category, PaymentMethod, TxNature, TxType } from "./types";

/**
 * Categorização automática do lançamento diário.
 *
 * Roda 100% local e determinístico — sem chamada a API de IA. Três motivos:
 * lançar gasto é operação de todo dia e não pode depender de rede; extrato
 * financeiro é dado sensível e não precisa sair da máquina; e o mesmo texto
 * tem que cair sempre na mesma categoria, senão o histórico fica incomparável.
 *
 * O acerto vem de duas fontes: um vocabulário embutido de marcas e termos reais
 * (ver seedRules em db.ts) e as regras APRENDIDAS quando você corrige um palpite.
 * Corrigir uma vez ensina para sempre.
 */

export interface Guess {
  categoryId: string | null;
  /** 0-1. Abaixo de 0.5 a UI pede confirmação em vez de assumir. */
  confidence: number;
  /** Qual palavra disparou o palpite — a UI mostra isso para você poder discordar. */
  matchedKeyword: string | null;
}

/**
 * Normaliza para comparar: minúsculas, sem acento, sem pontuação.
 * "Padaria São João" e "padaria sao joao" têm que colidir.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

export function guessCategory(description: string): Guess {
  const text = normalize(description);
  if (!text) return { categoryId: null, confidence: 0, matchedKeyword: null };

  const rules = getDb()
    .prepare(`SELECT keyword, categoryId, source, hits FROM category_rules`)
    .all() as unknown as RuleRow[];

  let best: { rule: RuleRow; score: number } | null = null;

  for (const rule of rules) {
    const kw = rule.keyword;
    let score = 0;

    if (text === kw) {
      score = 1; // texto idêntico à regra
    } else if (wordBoundaryRegex(kw).test(text)) {
      // Palavra inteira. Fronteira \b evita que "gas" case dentro de "gastos".
      score = 0.85;
    } else if (kw.length >= 5 && text.includes(kw)) {
      // Substring só para chaves longas o bastante para não gerar falso positivo.
      score = 0.6;
    } else {
      continue;
    }

    // Regra que você ensinou vale mais que a embutida: ela reflete o SEU vocabulário.
    if (rule.source === "learned") score += 0.1;
    // Desempate por uso: a que já acertou mais vezes ganha, com teto baixo
    // para o histórico não sequestrar um match textual melhor.
    score += Math.min(rule.hits, 20) * 0.002;
    // Chave mais longa é mais específica: "mercado livre" ganha de "mercado".
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
 * `guessCategory` roda uma vez por LINHA do lançamento em lote e o laço percorre
 * a tabela de regras inteira — compilar o mesmo `RegExp` dentro do laço era
 * `linhas × regras` compilações por chamada. As chaves vêm da tabela de regras,
 * que é finita e escrita pelo próprio app, então o mapa não cresce sem controle.
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
 * Aprende com uma correção. Guarda o termo mais informativo da descrição
 * (a palavra mais longa, ignorando ruído) apontando para a categoria certa.
 */
export function learnFromCorrection(description: string, categoryId: string): void {
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

  getDb()
    .prepare(
      `INSERT INTO category_rules (keyword, categoryId, source, hits, updatedAt)
       VALUES (?, ?, 'learned', 1, datetime('now'))
       ON CONFLICT(keyword) DO UPDATE SET
         categoryId = excluded.categoryId,
         source     = 'learned',
         hits       = category_rules.hits + 1,
         updatedAt  = datetime('now')`,
    )
    .run(token, categoryId);
}

/** Confirma que o palpite estava certo — reforça a regra sem criar nova. */
export function reinforce(keyword: string): void {
  getDb()
    .prepare(`UPDATE category_rules SET hits = hits + 1 WHERE keyword = ?`)
    .run(keyword);
}

// ------------------------------------------------------- lançamento em lote

export interface ParsedEntry {
  description: string;
  /** Em PARCELADO, é o TOTAL da compra (parcela × número de parcelas). */
  amountCents: number;
  type: TxType;
  nature: TxNature;
  /** Número de parcelas quando nature === "PARCELADO". */
  installments: number | null;
  /** Forma de pagamento detectada no texto ("pix", "debito"...). */
  method: PaymentMethod | null;
  categoryId: string | null;
  categoryName: string | null;
  confidence: number;
  matchedKeyword: string | null;
  /** Linha original, para você conferir o que foi interpretado. */
  raw: string;
}

/**
 * Interpreta o texto do dia inteiro de uma vez.
 *
 * Aceita o jeito que a pessoa realmente escreve, uma despesa por linha ou
 * separadas por vírgula/ponto-e-vírgula:
 *
 *     mercado 152,30
 *     uber 28
 *     ifood 45,90; netflix 39,90
 *     +salario 5400          <- o "+" marca entrada
 *
 * O valor é o último número da linha; o resto é a descrição. Essa ordem é a
 * natural em português ("uber 28"), e aceitar o valor no meio abriria margem
 * para interpretar errado descrições que contêm número ("99 pop 18").
 */
/** Comprimento máximo de uma linha do lançamento em lote. Ver o filtro abaixo. */
const MAX_LINE_CHARS = 400;

export function parseBulk(input: string, categories: Category[]): ParsedEntry[] {
  const byId = new Map(categories.map((c) => [c.id, c]));

  return input
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    /*
     * Linha absurdamente longa é descartada antes dos regexes de valor e
     * parcela, que fazem backtracking quadrático no comprimento da linha. Uma
     * linha de "descrição valor" real não chega perto disso — o teto só existe
     * para o texto colado de propósito para queimar CPU.
     */
    .filter((line) => line.length <= MAX_LINE_CHARS)
    .flatMap((line) => splitOnCommaIfSafe(line))
    .map((raw): ParsedEntry | null => {
      const line = raw.trim();
      if (!line) return null;

      // "+" no início marca entrada. Sem isso, tudo é saída — que é o caso comum.
      const isIncome = line.startsWith("+");
      const body = isIncome ? line.slice(1).trim() : line;

      const semMetodo = extractMethod(body);
      const parcelado = extractInstallments(semMetodo.description);
      if (!parcelado) return null;

      const { description, amountCents, installments } = parcelado;
      if (!description) return null;

      const guess = guessCategory(description);
      const category = guess.categoryId ? byId.get(guess.categoryId) : undefined;

      return {
        description,
        amountCents,
        type: isIncome ? "INCOME" : "EXPENSE",
        nature: installments ? "PARCELADO" : "VISTA",
        installments,
        method: semMetodo.method,
        categoryId: guess.categoryId,
        categoryName: category?.name ?? null,
        confidence: guess.confidence,
        matchedKeyword: guess.matchedKeyword,
        raw: line,
      };
    })
    .filter((e): e is ParsedEntry => e !== null);
}

/**
 * Extrai descrição, valor e número de parcelas de uma linha.
 *
 * As duas formas que as pessoas escrevem de fato, ambas aceitas porque a
 * posição do "Nx" já desfaz a ambiguidade sozinha:
 *
 *   "tenis 380 4x"   -> 380 é o TOTAL, dividido em 4 (parcelas de 95)
 *   "tenis 4x 95"    -> 95 é a PARCELA, total 380
 *   "tenis 380"      -> à vista
 *
 * A regra é posicional: "Nx" DEPOIS do valor lê o valor como total; "Nx" ANTES
 * do valor lê como "N vezes de". É como se fala — "380 em 4x" x "4x de 95".
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

  // Forma 2: "<desc> <N>x <valor>"  (o valor é o da parcela)
  const partsFirst = body.match(/^(.*?)\s*(\d{1,2})\s*x\s*(?:de\s*)?([\d.,]+)\s*$/i);
  if (partsFirst) {
    const perPart = parseBRLToCents(partsFirst[3]);
    const parts = Number(partsFirst[2]);
    if (perPart !== null && perPart > 0 && parts >= 2) {
      return {
        description: cleanDescription(partsFirst[1]),
        // O resto do sistema só lida com o total da compra.
        amountCents: perPart * parts,
        installments: parts,
      };
    }
  }

  // À vista: o valor é o último número da linha.
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
  return text.replace(/[-–—:]\s*$/, "").trim();
}

/**
 * Palavras que indicam a forma de pagamento no texto livre.
 * Escrever "mercado 152,30 pix" é mais rápido que abrir um select — e é como
 * a pessoa fala.
 */
const METHOD_WORDS: Array<[RegExp, PaymentMethod]> = [
  [/\bpix\b/i, "PIX"],
  [/\b(debito|débito|deb)\b/i, "DEBITO"],
  [/\b(credito|crédito|cred|cartao|cartão)\b/i, "CREDITO"],
  [/\b(dinheiro|especie|espécie|cash)\b/i, "DINHEIRO"],
  [/\bboleto\b/i, "BOLETO"],
  [/\b(transferencia|transferência|ted|doc)\b/i, "TRANSFERENCIA"],
];

/**
 * Extrai a forma de pagamento e a REMOVE da descrição.
 *
 * Deixar a palavra na descrição estragaria duas coisas: o histórico ficaria
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
 * Vírgula é ambígua em português: separa itens ("uber 28, ifood 45") e também
 * é o decimal ("28,50"). Só quebramos quando os dois lados têm letra — o que
 * indica descrições distintas, não um número partido ao meio.
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
      // dígito,dígito => decimal, mantém junto
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

/** Data padrão de um lançamento rápido: hoje. */
export function defaultEntryDate(): string {
  return today();
}

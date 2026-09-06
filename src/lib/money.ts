/**
 * Dinheiro em CENTAVOS (inteiro). Nunca float.
 *
 * `0.1 + 0.2 === 0.30000000000000004` em qualquer linguagem com float IEEE-754.
 * Somando 300 lançamentos por ano, esse erro vira diferença visível no fechamento
 * do mês. Todo valor entra, trafega e é gravado como inteiro de centavos; a
 * conversão para texto acontece só na borda de renderização.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 123456 -> "R$ 1.234,56" */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

/** 123456789 -> "R$ 1,2 mi" — só para eixo de gráfico, onde não cabe o valor cheio. */
export function formatBRLCompact(cents: number): string {
  return BRL_COMPACT.format(cents / 100);
}

/**
 * Valor com sinal explícito. A cor sozinha não pode carregar a informação
 * (regra de acessibilidade: "never rely on color alone"), então entrada e saída
 * são distinguíveis também por texto.
 */
export function formatSigned(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${BRL.format(Math.abs(cents) / 100)}`;
}

/**
 * Converte o que o usuário digitou em centavos.
 *
 * Aceita o que uma pessoa realmente digita no Brasil: "1.234,56", "1234,56",
 * "1234.56", "R$ 89,90", "89". Retorna null quando não dá para interpretar —
 * o chamador decide a mensagem de erro.
 */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s ]/g, "").trim();
  if (cleaned === "") return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // "1.234,56" -> ponto é separador de milhar, vírgula é decimal.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    // Ambíguo: "1.234" pode ser mil e duzentos e trinta e quatro OU 1,234.
    // Desempate pelo número de casas: exatamente 3 dígitos depois do último
    // ponto e nenhum outro ponto => separador de milhar.
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1];
    normalized = last.length === 3 ? cleaned.replace(/\./g, "") : cleaned;
  } else {
    normalized = cleaned;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  // Math.round evita o clássico 8990.000000000001 -> 8989 do truncamento.
  return Math.round(value * 100);
}

/**
 * Divide um total em N parcelas SEM perder nem inventar centavo.
 *
 * R$ 100,00 em 3x daria 3.333,333... centavos. Arredondar cada parcela e somar
 * devolveria R$ 99,99 ou R$ 100,02 — a compra parcelada não fecharia com o
 * preço da etiqueta, e o erro apareceria no total do ano.
 *
 * A regra é a que as operadoras de cartão usam: todas as parcelas recebem o
 * piso da divisão, e os centavos que sobram são distribuídos um a um nas
 * PRIMEIRAS parcelas. 10000 em 3x -> [3334, 3333, 3333]. A soma sempre bate.
 */
export function splitCents(totalCents: number, parts: number): number[] {
  if (parts < 1) return [totalCents];

  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;

  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Percentual seguro: divisor zero vira 0, não NaN nem Infinity. */
export function safePercent(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

/**
 * Datas como string "YYYY-MM-DD", nunca `Date`.
 *
 * Motivo concreto: `new Date("2026-03-01")` é interpretado como UTC meia-noite.
 * Em UTC-3 (Brasil) isso vira 28/02 21h local — o lançamento do dia 1º cai no
 * mês anterior e o fechamento do mês fica errado. String pura não tem fuso,
 * então não tem como errar. Só viramos `Date` para formatar em pt-BR.
 */

/** "YYYY-MM" do mês corrente, no fuso local. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" de hoje, no fuso local. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Soma (ou subtrai, com delta negativo) meses a um "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  // Índice absoluto de mês evita o wrap manual de dezembro/janeiro.
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return `${year}-${String(mon).padStart(2, "0")}`;
}

/**
 * Soma meses a uma data "YYYY-MM-DD", grudando no último dia quando o dia não
 * existe no mês de destino.
 *
 * Compra parcelada no dia 31/01 em 3x: a 2ª parcela cai em 28/02 (ou 29 em ano
 * bissexto), não em "31/02" nem em 03/03. Deixar o Date normalizar sozinho
 * jogaria a parcela para o mês seguinte e ela sumiria do fechamento de fevereiro.
 */
export function addMonthsToDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Em qual fatura cai uma compra no cartão, e quando essa fatura vence.
 *
 * Regra do ciclo: a fatura fecha no dia `closingDay` e vence no dia `dueDay`.
 * Compra feita ATÉ o fechamento entra na fatura que está fechando; compra
 * feita DEPOIS já pegou o ciclo seguinte. É por isso que comprar dia 28 com
 * fechamento dia 25 significa pagar só no mês seguinte ao seguinte.
 *
 * Quando `dueDay` é menor ou igual a `closingDay`, o vencimento é no mês
 * posterior ao fechamento (ciclo que atravessa a virada do mês) — caso comum
 * em cartão que fecha dia 25 e vence dia 5.
 *
 * Devolve a data de vencimento da primeira fatura afetada, "YYYY-MM-DD".
 */
export function firstInvoiceDueDate(
  purchaseDate: string,
  closingDay: number,
  dueDay: number,
): string {
  const [y, m, d] = purchaseDate.split("-").map(Number);

  // 0 = fecha no ciclo deste mês; 1 = já passou do fechamento, cai no próximo.
  const cycleShift = d > closingDay ? 1 : 0;
  // Vencimento antes do fechamento significa pagar no mês seguinte ao corte.
  const dueShift = dueDay <= closingDay ? 1 : 0;

  const totalMonths = y * 12 + (m - 1) + cycleShift + dueShift;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDay);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Os N meses até `end` (inclusive), do mais antigo para o mais recente. */
export function monthRange(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, -(count - 1 - i)));
}

/** Primeiro e último dia do mês, como "YYYY-MM-DD". */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  // Dia 0 do mês seguinte = último dia deste mês. Resolve 28/29/30/31 sozinho.
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
});

/** "2026-03" -> "mar. 26" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(y, m - 1, 1));
}

const MONTH_LONG = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

/** "2026-03" -> "março de 2026" */
export function formatMonthLong(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LONG.format(new Date(y, m - 1, 1));
}

const DATE_LABEL = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

/** "2026-03-09" -> "09/03" */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DATE_LABEL.format(new Date(y, m - 1, d));
}

/** Quantos dias tem o mês, e quantos já passaram (para projeção intra-mês). */
export function monthProgress(month: string): { total: number; elapsed: number } {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  const now = new Date();
  const isCurrent = currentMonth() === month;
  return { total, elapsed: isCurrent ? now.getDate() : total };
}

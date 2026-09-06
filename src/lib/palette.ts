/**
 * Paleta categórica dos gráficos.
 *
 * NÃO escolhida a olho. As cores que eu tinha posto à mão reprovaram no
 * validador da skill de dataviz com duas falhas reais:
 *   - 4 cores fora da faixa de luminosidade do modo escuro;
 *   - #0EA5E9 vs #3B82F6 com ΔE 9,8 para visão NORMAL (piso é 15) — dois azuis
 *     que ninguém distingue, nem quem enxerga todas as cores.
 *
 * Esta é a paleta de referência da skill, revalidada contra a NOSSA superfície
 * de card (#192134), não contra a superfície padrão dela:
 *
 *   node scripts/validate_palette.js "<hexes>" --mode dark --surface "#192134"
 *   → faixa de luminosidade PASS · croma PASS · separação CVD PASS (pior par
 *     ΔE 8,4 protan) · visão normal PASS (pior par ΔE 19,3) · contraste PASS
 *
 * A ORDEM é o mecanismo de segurança para daltonismo, não enfeite: cores
 * vizinhas na lista são as que aparecem juntas nos gráficos. Reordenar sem
 * rodar o validador de novo quebra a garantia.
 */
export const VIZ_PALETTE = [
  "#3987e5", // 1 azul
  "#d95926", // 2 laranja
  "#199e70", // 3 verde-água
  "#c98500", // 4 amarelo
  "#d55181", // 5 magenta
  "#008300", // 6 verde
  "#9085e9", // 7 violeta
  "#e66767", // 8 vermelho
] as const;

/**
 * Cor de uma categoria pela posição de criação.
 *
 * Acima de 8 categorias a lista reinicia. Isso é aceitável AQUI porque todo
 * gráfico que usa essas cores rotula cada série diretamente (nome no eixo da
 * barra, legenda na linha) — a cor reforça a identidade, não é o único canal
 * que a carrega. Se algum gráfico futuro depender só da cor, ele precisa
 * limitar a 8 séries e agrupar o resto em "Outros".
 */
export function paletteColor(index: number): string {
  return VIZ_PALETTE[index % VIZ_PALETTE.length];
}

/** Tinta do cromo do gráfico, alinhada aos tokens do app. */
export const CHART_INK = {
  grid: "rgba(255,255,255,0.08)",
  axis: "#94a3b8",
  label: "#94a3b8",
  surface: "#192134",
  tooltipBg: "#0f172a",
  income: "#34d399",
  expense: "#f87171",
  /** Série "investido" — recessiva, é referência e não protagonista. */
  invested: "#94a3b8",
  nominal: "#3987e5",
  real: "#199e70",
} as const;

/** Quantas séries um gráfico mostra antes de agrupar o resto em "Outros". */
export const MAX_SERIES = 8;

import { parseBRLToCents } from "./money";

/**
 * Leitura de fatura de cartão a partir do TEXTO já extraído do PDF.
 *
 * Recebe texto, não PDF: a extração acontece no navegador (ver
 * invoice-import.tsx) e esta função fica pura — testável sem arquivo, sem
 * senha e sem dependência de PDF.
 *
 * Não existe padrão de fatura no Brasil: cada emissor formata do seu jeito.
 * Por isso o resultado NUNCA é salvo direto — vai para uma tela de conferência.
 * Uma fatura mal interpretada não dá erro, ela envenena meses de histórico de
 * uma vez, e isso é bem pior que o trabalho de revisar.
 */

export interface InvoiceLine {
  /** "DD/MM" como veio na fatura. */
  rawDate: string;
  /** Data completa, com o ano inferido do período da fatura. */
  date: string;
  description: string;
  amountCents: number;
  /** Parcela atual, quando a linha indica "3/10". */
  installmentNo: number | null;
  installmentTotal: number | null;
  /** Linha original, para conferência. */
  raw: string;
}

export interface InvoiceParseResult {
  lines: InvoiceLine[];
  /** Linhas com cara de lançamento que não deu para interpretar. */
  ignoradas: string[];
  /** Total somado das linhas reconhecidas. */
  totalCents: number;
}

/**
 * Termos que aparecem em faturas mas NÃO são compras.
 *
 * Pagamento da fatura anterior e estorno reduzem a dívida; importá-los como
 * gasto contaria dinheiro que não saiu. Encargos e juros são gastos reais, mas
 * de natureza diferente — ficam de fora para o usuário decidir lançá-los à mão.
 */
const NAO_E_COMPRA = [
  /pagamento\s+(efetuado|recebido|fatura|em|de)/i,
  /pgto\.?\s+(efetuado|fatura)/i,
  /estorno/i,
  /cr[eé]dito\s+de\s+atraso/i,
  /saldo\s+(anterior|em)/i,
  /total\s+(da\s+)?fatura/i,
  /limite\s+(de\s+)?cr[eé]dito/i,
  /^subtotal/i,
  /^total/i,
  /vencimento/i,
  /^d[ée]bito\s+autom/i,
];

/**
 * Detecta "3/10", "PARCELA 3/10", "PARC 03/10".
 * O `(?!\d)` no fim evita casar a primeira metade de uma data (05/08/2026).
 */
const PARCELA = /(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*\/\s*(\d{1,2})\b(?!\s*\/?\d)/i;

/** Valor no fim da linha: 1.234,56 / 39,90 / -39,90 */
const VALOR_FINAL = /(-?\s?R?\$?\s?[\d.]{1,12},\d{2})\s*$/;

/** Data no começo da linha: 05/08 ou 05/08/2026 */
const DATA_INICIO = /^(\d{2})\s*\/\s*(\d{2})(?:\s*\/\s*(\d{2,4}))?\b/;

/**
 * Interpreta o texto inteiro da fatura.
 *
 * `periodo` é o mês de referência da fatura ("YYYY-MM"), usado para inferir o
 * ano das linhas — porque a fatura traz só "DD/MM". Uma compra de 28/12 numa
 * fatura de janeiro é do ano ANTERIOR; sem essa correção ela iria para o
 * futuro e sumiria do relatório do mês certo.
 */
export function parseInvoiceText(texto: string, periodo: string): InvoiceParseResult {
  const [anoRef, mesRef] = periodo.split("-").map(Number);

  const lines: InvoiceLine[] = [];
  const ignoradas: string[] = [];

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/\s+/g, " ").trim();
    if (linha.length < 8) continue;

    const mData = linha.match(DATA_INICIO);
    if (!mData) continue;

    const mValor = linha.match(VALOR_FINAL);
    if (!mValor) {
      // Tem data mas não tem valor: provavelmente cabeçalho ou linha quebrada.
      ignoradas.push(linha);
      continue;
    }

    if (NAO_E_COMPRA.some((re) => re.test(linha))) continue;

    const dia = Number(mData[1]);
    const mes = Number(mData[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) {
      ignoradas.push(linha);
      continue;
    }

    const textoValor = mValor[1].replace(/[R$\s]/g, "");
    const negativo = textoValor.startsWith("-");
    const cents = parseBRLToCents(textoValor.replace(/^-/, ""));

    // Valor negativo em fatura é crédito (estorno, desconto), não compra.
    if (cents === null || cents <= 0 || negativo) {
      if (cents === null) ignoradas.push(linha);
      continue;
    }

    // Descrição é o miolo: tira a data do começo e o valor do fim.
    let descricao = linha
      .slice(mData[0].length, linha.length - mValor[0].length)
      .trim();

    let installmentNo: number | null = null;
    let installmentTotal: number | null = null;

    const mParc = descricao.match(PARCELA);
    if (mParc) {
      const atual = Number(mParc[1]);
      const total = Number(mParc[2]);
      // 1/1 não é parcelamento, e total absurdo é falso positivo.
      if (total >= 2 && total <= 72 && atual >= 1 && atual <= total) {
        installmentNo = atual;
        installmentTotal = total;
        descricao = descricao.replace(mParc[0], " ").replace(/\s+/g, " ").trim();
      }
    }

    descricao = descricao.replace(/[-–—•|]+$/, "").trim();
    if (!descricao) {
      ignoradas.push(linha);
      continue;
    }

    /*
     * Ano da linha. A fatura traz só dia/mês; o ano vem do período dela.
     * Compra em dezembro numa fatura de janeiro/fevereiro é do ano anterior —
     * a diferença de mês grande é o sinal de virada de ano.
     */
    let ano = mData[3] ? normalizaAno(mData[3]) : anoRef;
    if (!mData[3] && mes - mesRef > 6) ano = anoRef - 1;
    if (!mData[3] && mesRef - mes > 6) ano = anoRef + 1;

    lines.push({
      rawDate: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`,
      date: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      description: descricao,
      amountCents: cents,
      installmentNo,
      installmentTotal,
      raw: linha,
    });
  }

  return {
    lines,
    ignoradas,
    totalCents: lines.reduce((acc, l) => acc + l.amountCents, 0),
  };
}

/** "26" -> 2026; "2026" -> 2026. */
function normalizaAno(texto: string): number {
  const n = Number(texto);
  return texto.length === 2 ? 2000 + n : n;
}

/**
 * Quantas parcelas AINDA FALTAM, e a partir de quando.
 *
 * A fatura mostra "3/10": três já foram cobradas, sete ainda vêm. Importar as
 * dez lançaria de novo as três que já passaram — e as passadas já estão nas
 * faturas anteriores. Só as futuras são criadas.
 */
export function parcelasRestantes(linha: InvoiceLine): number {
  if (!linha.installmentNo || !linha.installmentTotal) return 0;
  return Math.max(linha.installmentTotal - linha.installmentNo, 0);
}

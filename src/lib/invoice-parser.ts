import { parseBRLToCents } from "./money";

/**
 * Leitura de fatura de cartão a partir do TEXTO já extraído do PDF.
 *
 * Recebe texto, não PDF: a extração acontece no navegador (ver
 * invoice-import.tsx) e esta função fica pura — testável sem arquivo, sem
 * senha e sem dependência de PDF.
 *
 * Calibrada em faturas REAIS de dois emissores, que formatam de jeitos bem
 * diferentes:
 *
 *   C6 Bank:  "09 set CAMILA IMPORTS - Parcela 11/12 530,89"
 *             mês por extenso, parcela rotulada
 *
 *   Itaú:     "24/07 IFD*iFood 5,95 21/06 MERCADOLIVRE*MERCA02/02 24,84"
 *             DUAS transações na mesma linha (impressas em duas colunas),
 *             parcela colada no fim da descrição, sem espaço
 *
 * Por isso a varredura é GLOBAL dentro de cada linha em vez de assumir uma
 * transação por linha: no Itaú, assumir uma por linha perderia metade da
 * fatura silenciosamente.
 *
 * O resultado NUNCA é salvo direto — vai para conferência. Não existe padrão
 * de fatura no Brasil, e leitura errada não dá erro: ela envenena meses de
 * histórico de uma vez.
 */

export interface InvoiceLine {
  /** Data da compra, com o ano inferido. "YYYY-MM-DD". */
  date: string;
  description: string;
  /**
   * Positivo em compra, NEGATIVO em estorno.
   *
   * O estorno é dinheiro que a loja devolveu: ele abate a fatura. Ignorá-lo
   * faria o total importado ficar acima do que se paga de verdade — nesta
   * fatura do Itaú, R$ 150,18 acima.
   */
  amountCents: number;
  installmentNo: number | null;
  installmentTotal: number | null;
  /** Trecho original, para conferência. */
  raw: string;
}

export interface InvoiceParseResult {
  lines: InvoiceLine[];
  /** Linhas com cara de lançamento que não deu para interpretar. */
  ignoradas: string[];
  totalCents: number;
}

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/**
 * Termos que aparecem na fatura mas NÃO entram na conta de jeito nenhum.
 *
 * O pagamento da fatura anterior é o caso central: ele quita a dívida, não a
 * cria. Importado como compra, contaria de novo dinheiro que já saiu da conta
 * corrente. "Inclusao de Pagamento" é o texto que o C6 usa — descoberto na
 * fatura real, e não casaria com um filtro genérico de "pagamento efetuado".
 *
 * Estorno NÃO está aqui: ele entra, com valor negativo (ver CREDITO).
 */
const NAO_E_COMPRA = [
  /pagamento/i,
  /\bpgto\b/i,
  /saldo\s+(anterior|em)/i,
  /total\s+(da\s+)?fatura/i,
  /limite/i,
  /^subtotal/i,
  /anuidade/i,
  /encargo/i,
  /juros/i,
  /\biof\b/i,
  /multa/i,
  /^compras\s+(nacionais|internacionais)/i,
];

/**
 * Como cada emissor marca uma DEVOLUÇÃO.
 *
 * Itaú põe o sinal antes do valor ("MERCADOLIVRE*MERCADOLI - 0,01"); o C6
 * escreve a palavra e deixa o valor positivo ("LOJA - Estorno 360,00"). Os dois
 * significam a mesma coisa e viram valor negativo.
 *
 * Por que isso importa: o Itaú declara "Total dos lançamentos atuais" já
 * LÍQUIDO dos estornos. Somando só as compras, o app fechava R$ 150,18 acima
 * do que a fatura realmente cobra.
 */
const CREDITO = /estorno|devolu[çc][ãa]o/i;

/**
 * Uma transação dentro da linha. Varredura global: captura data (nos dois
 * formatos), descrição, sinal opcional de crédito e valor.
 */
const TRANSACAO = new RegExp(
  // data: "24/07" ou "09 set"
  "(\\d{1,2})\\s*(?:/\\s*(\\d{1,2})|\\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))" +
    // descrição: mínimo possível até chegar no valor
    "\\s+(.+?)" +
    // sinal de crédito opcional (" - 0,01" no Itaú) e valor
    "\\s+(-\\s*)?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})(?=\\s|$)",
  "gi",
);

/** Parcela no fim da descrição, colada ou não: "02/02", "- Parcela 11/12". */
const PARCELA_FINAL = /(?:-\s*)?(?:parcela\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

/**
 * Interpreta o texto inteiro da fatura.
 *
 * `periodo` é o mês de vencimento ("YYYY-MM"). Serve para inferir o ano das
 * compras, porque a fatura traz só dia e mês.
 */
export function parseInvoiceText(texto: string, periodo: string): InvoiceParseResult {
  const [anoRef, mesRef] = periodo.split("-").map(Number);

  const lines: InvoiceLine[] = [];
  const ignoradas: string[] = [];

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/\s+/g, " ").trim();
    if (linha.length < 8) continue;

    TRANSACAO.lastIndex = 0;
    let achou = false;
    let m: RegExpExecArray | null;

    while ((m = TRANSACAO.exec(linha)) !== null) {
      const trecho = m[0].trim();
      const dia = Number(m[1]);
      const mes = m[2] ? Number(m[2]) : MESES[m[3].toLowerCase()];
      const ehCredito = !!m[5] || CREDITO.test(m[4]);
      const cents = parseBRLToCents(m[6]);

      if (!mes || dia < 1 || dia > 31 || cents === null || cents <= 0) continue;
      achou = true;

      if (NAO_E_COMPRA.some((re) => re.test(trecho))) continue;

      let descricao = m[4].trim();

      let installmentNo: number | null = null;
      let installmentTotal: number | null = null;

      const mParc = descricao.match(PARCELA_FINAL);
      if (mParc) {
        const atual = Number(mParc[1]);
        const total = Number(mParc[2]);
        // 1/1 não é parcelamento; total absurdo é falso positivo.
        if (total >= 2 && total <= 72 && atual >= 1 && atual <= total) {
          installmentNo = atual;
          installmentTotal = total;
          descricao = descricao.slice(0, mParc.index).trim();
        }
      }

      descricao = descricao.replace(/[-–—•|]+\s*$/, "").trim();
      if (descricao.length < 2) continue;

      lines.push({
        date: inferirData(dia, mes, anoRef, mesRef),
        description: descricao,
        amountCents: ehCredito ? -cents : cents,
        installmentNo: ehCredito ? null : installmentNo,
        installmentTotal: ehCredito ? null : installmentTotal,
        raw: trecho,
      });
    }

    // Linha que começa com data mas não rendeu transação: pode ser compra que
    // o parser não entendeu. Vai para a lista de conferência em vez de sumir.
    if (!achou && /^\d{1,2}\s*(\/|\s+[a-z]{3}\b)/i.test(linha) && /\d,\d{2}/.test(linha)) {
      ignoradas.push(linha);
    }
  }

  const semPrevisao = removerPrevisaoDeParcelas(lines);

  return {
    lines: semPrevisao,
    ignoradas,
    totalCents: semPrevisao.reduce((acc, l) => acc + l.amountCents, 0),
  };
}

/**
 * Remove a seção de PREVISÃO das próximas faturas.
 *
 * O Itaú imprime, ao lado dos lançamentos do mês, uma coluna "Compras
 * parceladas - próximas faturas" com as parcelas que ainda vão vir. Lidas como
 * compra, elas inflavam a fatura em quase mil reais e duplicariam as parcelas
 * que o app já gera sozinho a partir do "1/3" da parcela atual.
 *
 * Cortar por posição não funciona: as duas colunas se intercalam na leitura, e
 * o terceiro cartão da fatura aparece DEPOIS do cabeçalho da previsão. A
 * distinção que vale em qualquer layout é outra — a previsão é sempre a
 * PARCELA SEGUINTE de uma compra já listada:
 *
 *     28/07 SHOPEE *continenta 01/03  <- cobrada agora
 *     28/07 SHOPEE *continenta 02/03  <- previsão do mês que vem
 *
 * Então, de cada compra parcelada, fica só a menor parcela.
 *
 * Limite conhecido: uma compra parcelada feita DEPOIS do fechamento aparece só
 * na previsão, sem par no mês, e seria importada como se fosse cobrada agora.
 * Ela é uma compra de verdade, só que da fatura seguinte — por isso a tela de
 * conferência mostra a data de cada linha antes de salvar.
 */
function removerPrevisaoDeParcelas(lines: InvoiceLine[]): InvoiceLine[] {
  const menorParcela = new Map<string, number>();

  const chave = (l: InvoiceLine) =>
    `${l.description.toLowerCase()}|${l.amountCents}|${l.installmentTotal}`;

  for (const l of lines) {
    if (!l.installmentNo || !l.installmentTotal) continue;
    const k = chave(l);
    const atual = menorParcela.get(k);
    if (atual === undefined || l.installmentNo < atual) {
      menorParcela.set(k, l.installmentNo);
    }
  }

  const jaVisto = new Set<string>();

  return lines.filter((l) => {
    if (!l.installmentNo || !l.installmentTotal) return true;
    const k = chave(l);
    if (l.installmentNo !== menorParcela.get(k)) return false;
    // Duas parcelas idênticas na mesma fatura: a segunda é repetição de layout.
    if (jaVisto.has(k)) return false;
    jaVisto.add(k);
    return true;
  });
}

/**
 * Ano da compra.
 *
 * A fatura traz só dia e mês. A regra que resolve todos os casos: a compra
 * nunca é POSTERIOR ao fechamento da fatura. Se o mês da compra é maior que o
 * mês da fatura, ela é do ano anterior.
 *
 * É o que faz "09 set" numa fatura de agosto/2026 virar 2025-09-09 (parcela 11
 * de 12, comprada um ano antes) em vez de setembro/2026 — que ainda nem
 * aconteceu.
 */
function inferirData(dia: number, mes: number, anoRef: number, mesRef: number): string {
  const ano = mes > mesRef ? anoRef - 1 : anoRef;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Quantas parcelas AINDA FALTAM.
 *
 * "3/10" significa que três já foram cobradas e sete ainda vêm. Importar as dez
 * lançaria de novo as três que já passaram — e essas já estão nas faturas
 * anteriores, então o mesmo dinheiro contaria duas vezes.
 */
export function parcelasRestantes(linha: InvoiceLine): number {
  if (!linha.installmentNo || !linha.installmentTotal) return 0;
  return Math.max(linha.installmentTotal - linha.installmentNo, 0);
}

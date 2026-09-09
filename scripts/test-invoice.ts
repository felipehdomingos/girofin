/**
 * Testes do leitor de fatura.
 *
 * As linhas abaixo são os FORMATOS REAIS de duas faturas (C6 Bank e Itaú),
 * com descrições trocadas. Cobrem o que estraga histórico em silêncio:
 * pagamento importado como compra, parcela já paga recriada, duas transações
 * na mesma linha, e ano errado em compra antiga.
 */
import { parseInvoiceText, parcelasRestantes } from "../src/lib/invoice-parser";


(globalThis as typeof globalThis & { __testPromises: Promise<void>[] }).__testPromises.push((async () => {
let ok = 0;
let fail = 0;

function check(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log("  ok    " + nome);
  } else {
    fail++;
    console.log("  FALHA " + nome);
    console.log("        esperado:", JSON.stringify(esperado));
    console.log("        obtido:  ", JSON.stringify(real));
  }
}

console.log("\n== formato C6 Bank (mês por extenso) ==");
const c6 = parseInvoiceText(
  [
    "Transações do cartão principal",
    "09 set LOJA IMPORTS - Parcela 11/12 530,89",
    "26 jan PIZZARIA CENTRAL - Parcela 7/10 250,00",
    "15 jul AMAZONPRIMEBR 19,90",
    "19 jul Inclusao de Pagamento 2.376,30",
    "24 jul MERCADOLIVRE*LOJA - Estorno 360,00",
    "27 jul 99FOOD *ESQUINA 23,00",
    "28 jul DL *ALIEXPRESS BR ALIP 95,83",
  ].join("\n"),
  "2026-08",
);

check("leu as linhas do C6", c6.lines.length, 6);
check(
  "'Inclusao de Pagamento' não virou compra",
  c6.lines.some((l) => /pagamento/i.test(l.description)),
  false,
);

/*
 * O C6 marca devolução com a palavra e valor positivo; o Itaú, com sinal antes
 * do valor. As duas viram valor NEGATIVO — a fatura real do C6 declara
 * "Estornos / Crédito na Fatura (-) 410,00", que abate o que se paga.
 */
const estorno = c6.lines.find((l) => /Estorno/i.test(l.description));
check("estorno entra como crédito negativo", estorno?.amountCents, -36000);
check("estorno não vira parcelamento", estorno?.installmentTotal, null);

const loja = c6.lines.find((l) => /LOJA IMPORTS/.test(l.description));
check("parcela 11/12 detectada", [loja?.installmentNo, loja?.installmentTotal], [11, 12]);
check("descrição sem o rótulo de parcela", loja?.description, "LOJA IMPORTS");
check("falta 1 parcela", loja ? parcelasRestantes(loja) : -1, 1);
check("valor com milhar", c6.lines.find((l) => /ALIEXPRESS/.test(l.description))?.amountCents, 9583);

/*
 * "09 set" numa fatura de AGOSTO/2026 é setembro do ano ANTERIOR — é parcela
 * 11 de 12, comprada quase um ano antes. Sem isso a compra iria para setembro
 * de 2026, que ainda nem aconteceu.
 */
check("compra de mês posterior é do ano anterior", loja?.date, "2025-09-09");
check("compra do mesmo ano mantém o ano", c6.lines.find((l) => /AMAZON/.test(l.description))?.date, "2026-07-15");

console.log("\n== formato Itaú (duas colunas na mesma linha) ==");
const itau = parseInvoiceText(
  [
    "24/07 IFD*iFood 5,95 21/06 MERCADOLIVRE*MERCA02/02 24,84",
    "21/06 MERCADOLIVRE*MERCADOLI - 0,01",
    "03/07 Wellhub Carlos 54,90",
    "10/01 BLUE BEACH SAO PAU07/12 190,00",
    "21/05 FelipeHenriq-CT 03/03 100,00",
    "05/07 NETFLIX ENTRETENIMENTO 59,90",
  ].join("\n"),
  "2026-09",
);

check("duas transações na mesma linha viraram duas", itau.lines.length, 7);
check("primeira da linha dupla", itau.lines[0]?.description, "IFD*iFood");
check("valor da primeira", itau.lines[0]?.amountCents, 595);
check("segunda da linha dupla", itau.lines[1]?.description, "MERCADOLIVRE*MERCA");
check("valor da segunda", itau.lines[1]?.amountCents, 2484);
check("parcela colada na descrição", [itau.lines[1]?.installmentNo, itau.lines[1]?.installmentTotal], [2, 2]);

const blue = itau.lines.find((l) => /BLUE BEACH/.test(l.description));
check("parcela 07/12 colada", [blue?.installmentNo, blue?.installmentTotal], [7, 12]);
check("descrição limpa", blue?.description, "BLUE BEACH SAO PAU");

const felipe = itau.lines.find((l) => /FelipeHenriq/.test(l.description));
check("parcela com espaço 03/03", [felipe?.installmentNo, felipe?.installmentTotal], [3, 3]);
check("última parcela não gera futuras", felipe ? parcelasRestantes(felipe) : -1, 0);

check(
  "crédito com sinal '-' entra negativo",
  itau.lines.find((l) => /MERCADOLI$/.test(l.description))?.amountCents,
  -1,
);
check(
  "total do Itaú é líquido dos estornos",
  itau.totalCents,
  595 + 2484 + 5490 + 19000 + 10000 + 5990 - 1,
);

/*
 * A seção "Compras parceladas - próximas faturas" é PREVISÃO, não cobrança do
 * mês. Lê-la como compra inflava a fatura real do Itaú em R$ 769,01 — e
 * duplicaria as parcelas, porque o app já as gera a partir do "1/3" da atual.
 *
 * Cortar por posição não funciona: as duas colunas se intercalam, e o terceiro
 * cartão da fatura é impresso DEPOIS do cabeçalho da previsão. O que vale em
 * qualquer layout é que a previsão é sempre a parcela SEGUINTE de uma compra já
 * listada — então fica só a menor parcela de cada compra.
 */
console.log("\n== previsão das próximas faturas ==");
const previsao = parseInvoiceText(
  [
    "28/07 SHOPEE *continenta01/03 16,06",
    "28/07 SHOPEE *COMETDISTR01/03 21,45",
    "Compras parceladas - próximas faturas",
    "28/07 SHOPEE *continenta02/03 16,06",
    "28/07 SHOPEE *COMETDISTR02/03 21,45",
  ].join("\n"),
  "2026-09",
);
check("previsão não vira compra do mês", previsao.lines.length, 2);
check("sobra a parcela cobrada agora", previsao.lines.map((l) => l.installmentNo), [1, 1]);
check("total sem a previsão", previsao.totalCents, 1606 + 2145);

console.log("\n== casos que enganam ==");
const umDeUm = parseInvoiceText("05/08 LOJA 1/1 50,00", "2026-08");
check("1/1 não é parcelamento", umDeUm.lines[0]?.installmentTotal, null);

const semParcela = parseInvoiceText("06/07 SHEIN *48.869.576 VILM 183,60", "2026-08");
check("número na descrição não vira parcela", semParcela.lines[0]?.installmentTotal, null);
check("descrição com pontos preservada", semParcela.lines[0]?.description, "SHEIN *48.869.576 VILM");

const cabecalho = parseInvoiceText("Compras nacionais 2.571,00\nLimite total: R$ 24.769,04", "2026-08");
check("cabeçalho não vira compra", cabecalho.lines.length, 0);

console.log("\n== total ==");
// Líquido: é o que a fatura cobra, não o que foi comprado.
check("soma do C6 abate o estorno", c6.totalCents, 53089 + 25000 + 1990 + 2300 + 9583 - 36000);

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

})());



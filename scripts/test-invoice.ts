/**
 * Testes do leitor de fatura.
 *
 * Cobrem os casos que estragam o histórico em silêncio: pagamento importado
 * como compra, parcela já paga recriada, virada de ano jogando compra de
 * dezembro para o futuro, e "05/08" confundido com parcela.
 */
import { parseInvoiceText, parcelasRestantes } from "../src/lib/invoice-parser";

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

console.log("\n== leitura de fatura ==");

const texto = [
  "FATURA DE AGOSTO 2026",
  "VENCIMENTO 15/08/2026 TOTAL 1.234,56",
  "05/08 NETFLIX.COM 39,90",
  "07/08 UBER *TRIP 23,45",
  "10/08 MAGAZINE LUIZA 03/10 150,00",
  "12/08 PARCELA 02/06 CASAS BAHIA 99,90",
  "14/08 PAGAMENTO EFETUADO -500,00",
  "15/08 ESTORNO COMPRA 45,00",
  "16/08 POSTO IPIRANGA 1.200,00",
  "linha qualquer sem estrutura",
].join("\n");

const r = parseInvoiceText(texto, "2026-08");

check("reconheceu 5 compras", r.lines.length, 5);
check("pagamento não virou compra", r.lines.some((l) => /pagamento/i.test(l.description)), false);
check("estorno não virou compra", r.lines.some((l) => /estorno/i.test(l.description)), false);
check("valor com milhar", r.lines.find((l) => /ipiranga/i.test(l.description))?.amountCents, 120000);
check("valor simples", r.lines.find((l) => /netflix/i.test(l.description))?.amountCents, 3990);

const magazine = r.lines.find((l) => /magazine/i.test(l.description));
check("detectou parcela 3/10", [magazine?.installmentNo, magazine?.installmentTotal], [3, 10]);
check("tirou a parcela da descrição", magazine?.description, "MAGAZINE LUIZA");
check("faltam 7 parcelas", magazine ? parcelasRestantes(magazine) : -1, 7);

const casas = r.lines.find((l) => /casas bahia/i.test(l.description));
check("detectou 'PARCELA 02/06'", [casas?.installmentNo, casas?.installmentTotal], [2, 6]);

check("data completa com ano da fatura", r.lines[0]?.date, "2026-08-05");

console.log("\n== virada de ano ==");
/*
 * Compra de 28/12 numa fatura de JANEIRO é do ano anterior. Sem isso ela iria
 * para dezembro do ano corrente — no futuro — e sumiria do mês certo.
 */
const viradaJan = parseInvoiceText("28/12 COMPRA DE DEZEMBRO 100,00", "2027-01");
check("dezembro em fatura de janeiro é do ano anterior", viradaJan.lines[0]?.date, "2026-12-28");

const viradaDez = parseInvoiceText("03/01 COMPRA DE JANEIRO 100,00", "2026-12");
check("janeiro em fatura de dezembro é do ano seguinte", viradaDez.lines[0]?.date, "2027-01-03");

const mesmoAno = parseInvoiceText("05/08 COMPRA NORMAL 100,00", "2026-08");
check("mês próximo mantém o ano da fatura", mesmoAno.lines[0]?.date, "2026-08-05");

console.log("\n== não confundir data com parcela ==");
const comData = parseInvoiceText("05/08 SUPERMERCADO 05/08/2026 250,00", "2026-08");
check(
  "data no meio não vira parcela",
  [comData.lines[0]?.installmentNo, comData.lines[0]?.installmentTotal],
  [null, null],
);

const umDeUm = parseInvoiceText("05/08 LOJA 1/1 50,00", "2026-08");
check("1/1 não é parcelamento", umDeUm.lines[0]?.installmentTotal, null);

console.log("\n== total ==");
check("soma das compras", r.totalCents, 3990 + 2345 + 15000 + 9990 + 120000);

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

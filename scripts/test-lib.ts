/**
 * Teste das regras de negócio puras. Roda com `npm run test`.
 *
 * Não é framework de teste — é um script que exercita o que quebra silencioso:
 * parsing de dinheiro, aritmética de datas, juros compostos e a categorização
 * automática. Erro nessas quatro coisas não aparece na tela como erro, aparece
 * como número errado, que é muito pior.
 */

import { parseBRLToCents, formatBRL, splitCents } from "../src/lib/money";
import {
  addMonths,
  addMonthsToDate,
  firstInvoiceDueDate,
  monthBounds,
  monthRange,
} from "../src/lib/dates";
import { annualToMonthly, project, monthsToReach, realRate } from "../src/lib/finance";
import { parseBulk, normalize, guessCategory } from "../src/lib/categorize";
import { listCategories } from "../src/lib/repo";


(globalThis as typeof globalThis & { __testPromises: Promise<void>[] }).__testPromises.push((async () => {
let passed = 0;
let failed = 0;

function check(nome: string, real: unknown, esperado: unknown): void {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) {
    passed++;
    console.log(`  ok   ${nome}`);
  } else {
    failed++;
    console.log(`  FALHA ${nome}`);
    console.log(`        esperado: ${JSON.stringify(esperado)}`);
    console.log(`        obtido:   ${JSON.stringify(real)}`);
  }
}

function checkNear(nome: string, real: number, esperado: number, tol: number): void {
  const ok = Math.abs(real - esperado) <= tol;
  if (ok) {
    passed++;
    console.log(`  ok   ${nome} (${real.toFixed(4)})`);
  } else {
    failed++;
    console.log(`  FALHA ${nome}: esperado ~${esperado}, obtido ${real}`);
  }
}

console.log("\n== dinheiro ==");
check("1.234,56 (milhar + decimal)", parseBRLToCents("1.234,56"), 123456);
check("1234,56", parseBRLToCents("1234,56"), 123456);
check("1234.56 (ponto decimal)", parseBRLToCents("1234.56"), 123456);
check("R$ 89,90 com simbolo", parseBRLToCents("R$ 89,90"), 8990);
check("89 sem centavos", parseBRLToCents("89"), 8900);
check("1.234 = milhar, nao decimal", parseBRLToCents("1.234"), 123400);
check("texto invalido", parseBRLToCents("abc"), null);
check("vazio", parseBRLToCents(""), null);
// O caso que motiva usar inteiro: 0.1+0.2 em float dá 0.30000000000000004.
check("8990 nao vira 8989 (arredondamento)", parseBRLToCents("89,90"), 8990);
check("formata de volta", formatBRL(123456).replace(/\u00a0/g, " "), "R$ 1.234,56");

console.log("\n== datas ==");
check("virada de ano p/ frente", addMonths("2026-12", 1), "2027-01");
check("virada de ano p/ tras", addMonths("2026-01", -1), "2025-12");
check("salto de 14 meses", addMonths("2026-03", 14), "2027-05");
check("fevereiro bissexto", monthBounds("2028-02").end, "2028-02-29");
check("fevereiro comum", monthBounds("2026-02").end, "2026-02-28");
check("mes de 30 dias", monthBounds("2026-04").end, "2026-04-30");
check("range de 3 meses", monthRange("2026-03", 3), ["2026-01", "2026-02", "2026-03"]);

console.log("\n== juros ==");
// 12% a.a. NÃO é 1% a.m. — a taxa equivalente é 0,9489%.
checkNear("taxa mensal equivalente a 12% a.a.", annualToMonthly(12) * 100, 0.9489, 0.001);
checkNear(
  "12 meses da taxa mensal voltam a 12% a.a.",
  (Math.pow(1 + annualToMonthly(12), 12) - 1) * 100,
  12,
  0.0001,
);
// R$ 1.000 a 10% por 1 ano, sem aporte, = R$ 1.100.
checkNear(
  "1000 a 10% por 12m",
  project({
    initialCents: 100000,
    monthlyCents: 0,
    months: 12,
    annualPct: 10,
    inflationPct: 0,
  }).finalCents,
  110000,
  50,
);
checkNear(
  "taxa real com inflacao igual = 0",
  realRate(10, 10),
  0,
  0.0001,
);
check(
  "alvo ja atingido = 0 meses",
  monthsToReach({
    initialCents: 100000,
    monthlyCents: 0,
    targetCents: 50000,
    annualPct: 10,
  }),
  0,
);
check(
  "inalcancavel = null",
  monthsToReach({
    initialCents: 0,
    monthlyCents: 0,
    targetCents: 100000,
    annualPct: 0,
  }),
  null,
);

console.log("\n== normalizacao ==");
check("remove acento e caixa", normalize("Padaria São João"), "padaria sao joao");
check("remove pontuacao", normalize("Uber - 28/09"), "uber 28 09");

console.log("\n== categorizacao ==");
const categories = await listCategories();
const byId = new Map(categories.map((c) => [c.id, c.name]));

async function categoriaDe(desc: string): Promise<string | null> {
  const g = await guessCategory(desc);
  return g.categoryId ? (byId.get(g.categoryId) ?? null) : null;
}

check("ifood -> Restaurantes", await categoriaDe("ifood almoco"), "Restaurantes");
check("uber -> Transporte", await categoriaDe("uber para o trabalho"), "Transporte");
check("netflix -> Assinaturas", await categoriaDe("netflix"), "Assinaturas");
check("carrefour -> Mercado", await categoriaDe("carrefour compras"), "Mercado");
check("aluguel -> Moradia", await categoriaDe("aluguel do mes"), "Moradia");
check("farmacia -> Saude", await categoriaDe("farmacia remedio"), "Saúde");
check("desconhecido -> nenhum", await categoriaDe("zxcvbnm qwerty"), null);
// "gas" não pode casar dentro de "gastos" — por isso o \b no regex.
check("gas nao casa dentro de gastos", await categoriaDe("gastos diversos"), null);

console.log("\n== lancamento em lote ==");
const parsed = await parseBulk(
  "mercado 152,30\nuber 28\nifood 45,90; netflix 39,90\n+salario 5400",
  categories,
);
check("interpretou 5 lancamentos", parsed.length, 5);
check("valor com decimal", parsed[0].amountCents, 15230);
check("valor inteiro", parsed[1].amountCents, 2800);
check("quebrou no ponto-e-virgula", parsed[3].description, "netflix");
check("+ marca entrada", parsed[4].type, "INCOME");
check("resto e saida", parsed[0].type, "EXPENSE");
check("categorizou o mercado", byId.get(parsed[0].categoryId ?? ""), "Mercado");

// A vírgula é ambígua: separa itens E é decimal. Não pode partir "28,50".
const virgula = await parseBulk("uber 28,50, ifood 45", categories);
check("virgula decimal nao quebra o valor", virgula.length, 2);
check("valor decimal preservado", virgula[0].amountCents, 2850);

// Descrição com número no meio não pode confundir o parser.
const comNumero = await parseBulk("99 pop 18,50", categories);
check("numero na descricao", comNumero[0].description, "99 pop");
check("valor e o ultimo numero", comNumero[0].amountCents, 1850);

console.log("\n== divisao de parcelas ==");
// A soma das parcelas TEM que bater com o total. Sempre.
check("100,00 em 3x", splitCents(10000, 3), [3334, 3333, 3333]);
check("soma bate com o total", splitCents(10000, 3).reduce((a, b) => a + b, 0), 10000);
check("divisao exata", splitCents(12000, 4), [3000, 3000, 3000, 3000]);
check("1 centavo em 3x", splitCents(1, 3), [1, 0, 0]);
check("soma de 1 centavo", splitCents(1, 3).reduce((a, b) => a + b, 0), 1);
for (const [total, parts] of [
  [99999, 7],
  [1, 12],
  [123457, 11],
  [5000, 3],
] as const) {
  check(
    `soma fecha: ${total} em ${parts}x`,
    splitCents(total, parts).reduce((a, b) => a + b, 0),
    total,
  );
}

console.log("\n== datas de parcela ==");
check("mes seguinte", addMonthsToDate("2026-01-15", 1), "2026-02-15");
// Dia 31 em mês curto gruda no último dia, não vaza para o mês seguinte.
check("31/01 + 1 mes = 28/02", addMonthsToDate("2026-01-31", 1), "2026-02-28");
check("31/01 + 1 mes bissexto", addMonthsToDate("2028-01-31", 1), "2028-02-29");
check("31/03 + 1 mes = 30/04", addMonthsToDate("2026-03-31", 1), "2026-04-30");
check("vira o ano", addMonthsToDate("2026-11-10", 3), "2027-02-10");
// O dia original volta quando o mês comporta — não fica preso no dia 28.
check("31/01 + 2 meses = 31/03", addMonthsToDate("2026-01-31", 2), "2026-03-31");

console.log("\n== fatura do cartao ==");
// Cartão fecha dia 25, vence dia 5 do mês seguinte.
check(
  "compra dia 10 (antes do fechamento)",
  firstInvoiceDueDate("2026-09-10", 25, 5),
  "2026-10-05",
);
check(
  "compra dia 28 (depois do fechamento) pula uma fatura",
  firstInvoiceDueDate("2026-09-28", 25, 5),
  "2026-11-05",
);
check(
  "compra no dia exato do fechamento abre a proxima fatura",
  firstInvoiceDueDate("2026-09-25", 25, 5),
  "2026-11-05",
);
// O próprio dia do fechamento já abre o ciclo seguinte.
check(
  "dia do fechamento abre o ciclo seguinte",
  firstInvoiceDueDate("2026-09-01", 1, 10),
  "2026-10-10",
);
check("virada de ano na fatura", firstInvoiceDueDate("2026-12-28", 25, 5), "2027-02-05");

/*
 * Cartão que fecha dia 3 e vence dia 10: a virada no começo do mês.
 *
 * É o caso do cartão real: dia 3 é a virada, então o ciclo de outubro vai de
 * 03/set a 02/out. Fechamento no começo do mês é o que mais confunde, porque
 * quase todo o mês já pertence à fatura seguinte.
 */
check("dia 1 entra na fatura de setembro", firstInvoiceDueDate("2026-09-01", 3, 10), "2026-09-10");
check("dia 3, a virada, entra em outubro", firstInvoiceDueDate("2026-09-03", 3, 10), "2026-10-10");
check("dia 4 continua na fatura de outubro", firstInvoiceDueDate("2026-09-04", 3, 10), "2026-10-10");
check("dia 30 tambem e outubro", firstInvoiceDueDate("2026-09-30", 3, 10), "2026-10-10");

console.log("\n== parcelamento no texto ==");
const p1 = await parseBulk("tenis 380 4x", categories);
check("valor antes do Nx = total", p1[0].amountCents, 38000);
check("4 parcelas", p1[0].installments, 4);
check("marcado como parcelado", p1[0].nature, "PARCELADO");
check("descricao limpa", p1[0].description, "tenis");

const p2 = await parseBulk("tenis 4x 95", categories);
check("Nx antes do valor = valor da parcela", p2[0].amountCents, 38000);
check("mesmo numero de parcelas", p2[0].installments, 4);

const p3 = await parseBulk("mercado 152,30", categories);
check("sem Nx e a vista", p3[0].nature, "VISTA");
check("sem parcelas", p3[0].installments, null);
// "99 pop" não pode ser lido como 99 parcelas.
check("descricao com numero continua a vista", (await parseBulk("99 pop 23", categories))[0].nature, "VISTA");

console.log(`\n${passed} passaram, ${failed} falharam\n`);
if (failed > 0) process.exit(1);

})());



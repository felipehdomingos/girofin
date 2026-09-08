/**
 * Teste do ciclo da fatura do cartÃ£o.
 *
 * O que precisa ser verdade:
 *  1. Compra no cartÃ£o vira gasto no mÃªs do VENCIMENTO da fatura
 *  2. A fatura aparece sozinha em Contas a pagar
 *  3. Pagar a fatura NÃƒO conta como despesa nova (senÃ£o dobra o mÃªs)
 *  4. Pagar a fatura tira o dinheiro da conta e zera o cartÃ£o
 */
import {
  addMonthsToDate,
  currentMonth,
  firstInvoiceDueDate,
  today,
} from "../src/lib/dates";
import { transactionSchema } from "../src/lib/validation";
import { formatBRL } from "../src/lib/money";
import {
  createAccount,
  createTransaction,
  getBillsForMonth,
  getCardInvoice,
  getMonthSummary,
  getRangeSeries,
  getRangeSummary,
  listAccountsWithBalance,
  listTransactionsInRange,
  listCategories,
  payCardInvoice,
  payScheduledTransaction,
} from "../src/lib/repo";


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

const marca = Date.now().toString(36);
const mes = currentMonth();
const hoje = today();
const categoria = (await listCategories())[0];

// Conta corrente com R$ 5.000 e cartÃ£o que fecha dia 25 / vence dia 5.
const contaId = await createAccount({
  name: `Conta teste ${marca}`,
  kind: "CORRENTE",
  openingCents: 500000,
  closingDay: null,
  dueDay: null,
  last4: null,
  creditLimitCents: null,
  overdraftLimitCents: null,
  bankIspb: null,
  bankName: null,
  logoUrl: null,
  color: "#3987e5",
});

const cartaoId = await createAccount({
  name: `Cartao teste ${marca}`,
  kind: "CARTAO",
  openingCents: 0,
  closingDay: 25,
  dueDay: 5,
  last4: "9999",
  creditLimitCents: 800000,
  overdraftLimitCents: null,
  bankIspb: null,
  bankName: null,
  logoUrl: null,
  color: "#d95926",
});

// Compra de R$ 300 no cartÃ£o, hoje.
await createTransaction({
  type: "EXPENSE",
  amountCents: 30000,
  date: hoje,
  description: `Compra teste ${marca}`,
  categoryId: categoria.id,
  nature: "VISTA",
  accountId: cartaoId,
  incomeSourceId: null,
  method: "CREDITO",
  notes: null,
});

console.log("\n== 1. a compra caiu no mÃªs do vencimento da fatura ==");
// Hoje Ã© dia 6; fechamento dia 25 => entra na fatura que vence dia 5 do mÃªs seguinte.
const mesFatura =
  Number(hoje.slice(8, 10)) > 25
    ? null
    : `${mes.slice(0, 4)}-${String(Number(mes.slice(5, 7)) + 1).padStart(2, "0")}`;
const faturaMes = mesFatura ?? mes;
check("fatura do cartÃ£o soma a compra", await getCardInvoice(cartaoId, faturaMes), 30000);

console.log("\n== 2. a fatura aparece em Contas a pagar sozinha ==");
const contas = await getBillsForMonth(faturaMes);
const fatura = contas.find((b) => b.bill.id === `card:${cartaoId}`);
check("fatura listada", fatura !== undefined, true);
check("valor da fatura", fatura?.bill.amountCents, 30000);
check("marcada como a vencer", fatura?.status, "UPCOMING");

console.log("\n== 3. saldos antes do pagamento ==");
const antes = await listAccountsWithBalance(mes);
const contaAntes = antes.find((a) => a.id === contaId);
const cartaoAntes = antes.find((a) => a.id === cartaoId);
check("conta com 5.000", contaAntes?.balanceCents, 500000);
check("cartÃ£o devendo 300", cartaoAntes?.balanceCents, -30000);

const totalAntes = (await getMonthSummary(faturaMes)).expenseCents;
console.log("   despesa do mÃªs da fatura:", formatBRL(totalAntes));

console.log("\n== 4. pagar a fatura: transfere, nÃ£o vira despesa nova ==");
await payCardInvoice({
  cardId: cartaoId,
  fromAccountId: contaId,
  amountCents: 30000,
  date: `${faturaMes}-05`,
});

const totalDepois = (await getMonthSummary(faturaMes)).expenseCents;
check("despesa do mÃªs NÃƒO dobrou", totalDepois, totalAntes);

const depois = await listAccountsWithBalance(mes);
const contaDepois = depois.find((a) => a.id === contaId);
const cartaoDepois = depois.find((a) => a.id === cartaoId);
check("saiu 300 da conta", contaDepois?.balanceCents, 470000);
check("cartÃ£o zerado", cartaoDepois?.balanceCents, 0);

const contasDepois = await getBillsForMonth(faturaMes);
check(
  "fatura marcada como paga",
  contasDepois.find((b) => b.bill.id === `card:${cartaoId}`)?.status,
  "PAID",
);

console.log("\n== 5. fatura que jÃ¡ existia no cadastro entra na lista ==");
/*
 * Cadastrar um cartÃ£o informando "fatura em aberto hoje" precisa gerar uma
 * conta a pagar. Antes o valor aparecia no saldo do cartÃ£o mas nÃ£o em Contas a
 * pagar â€” o cartÃ£o mostrava dÃ­vida e nÃ£o havia nada para quitar.
 */
const cartaoComFatura = await createAccount({
  name: `Cartao com fatura ${marca}`,
  kind: "CARTAO",
  openingCents: 63199,
  closingDay: 3,
  dueDay: 13,
  last4: null,
  creditLimitCents: 120000,
  overdraftLimitCents: null,
  bankIspb: null,
  bankName: null,
  logoUrl: null,
  color: "#9085e9",
});

const contaCartao = (await listAccountsWithBalance(mes)).find((a) => a.id === cartaoComFatura);
// Digitado sem sinal, guardado como dÃ­vida: pagar precisa somar em direÃ§Ã£o a zero.
check("saldo de abertura guardado como dÃ­vida", contaCartao?.balanceCents, -63199);

// Fecha dia 3 e vence dia 13: a fatura de abertura cai no mÃªs seguinte ao
// cadastro quando a compra Ã© feita depois do fechamento.
const mesAbertura = firstInvoiceDueDate(hoje, 3, 13).slice(0, 7);
check(
  "fatura de abertura tem o valor informado",
  await getCardInvoice(cartaoComFatura, mesAbertura),
  63199,
);
check(
  "fatura de abertura aparece em Contas a pagar",
  (await getBillsForMonth(mesAbertura)).some(
    (b) => b.bill.id === `card:${cartaoComFatura}` && b.bill.amountCents === 63199,
  ),
  true,
);

console.log("\n== 6. compromisso futuro nÃ£o exige conta de origem ==");
/*
 * Boleto que vence semana que vem ainda nÃ£o saiu de conta nenhuma. Exigir a
 * origem no cadastro obrigaria a inventar uma resposta, e um palpite errado Ã©
 * pior que campo vazio: some do saldo de uma conta que nunca pagou aquilo.
 */
const amanha = addMonthsToDate(hoje, 1);

const futuroSemConta = transactionSchema.safeParse({
  type: "EXPENSE",
  amount: "175,31",
  date: amanha,
  description: "Boleto faculdade",
  categoryId: categoria.id,
  nature: "VISTA",
  amountMode: "TOTAL",
  accountId: null,
  method: null,
});
check("data futura sem conta Ã© aceita", futuroSemConta.success, true);

const hojeSemConta = transactionSchema.safeParse({
  type: "EXPENSE",
  amount: "175,31",
  date: hoje,
  description: "Compra de hoje",
  categoryId: categoria.id,
  nature: "VISTA",
  amountMode: "TOTAL",
  accountId: null,
  method: null,
});
check("data de hoje sem conta Ã© rejeitada", hojeSemConta.success, false);

const passadoSemConta = transactionSchema.safeParse({
  type: "EXPENSE",
  amount: "50,00",
  date: "2020-01-15",
  description: "Gasto antigo",
  categoryId: categoria.id,
  nature: "VISTA",
  amountMode: "TOTAL",
  accountId: null,
  method: null,
});
check("data passada sem conta Ã© rejeitada", passadoSemConta.success, false);

console.log("\n== 7. lanÃ§amento agendado aparece em Contas a pagar ==");
/*
 * O caso real: "mensalidade da faculdade, vence 09/09" lanÃ§ada sem conta.
 * Antes ficava sÃ³ no extrato, invisÃ­vel na tela feita para responder
 * "o que eu tenho que pagar".
 */
const daquiUmMes = addMonthsToDate(hoje, 1);
const mesFuturo = daquiUmMes.slice(0, 7);

const agendadoId = await createTransaction({
  type: "EXPENSE",
  amountCents: 17547,
  date: daquiUmMes,
  description: `Mensalidade ${marca}`,
  categoryId: categoria.id,
  nature: "VISTA",
  accountId: null,
  incomeSourceId: null,
  method: null,
  notes: null,
});

const aPagarFuturo = await getBillsForMonth(mesFuturo);
const agendado = aPagarFuturo.find((b) => b.bill.id === `tx:${agendadoId}`);
check("agendado listado em Contas a pagar", agendado !== undefined, true);
check("com o valor certo", agendado?.bill.amountCents, 17547);
check("com o vencimento certo", agendado?.dueDate, daquiUmMes);

// Quitar tem que ATUALIZAR a linha, nÃ£o criar outra.
const gastoAntes = (await getMonthSummary(mesFuturo)).expenseCents;
await payScheduledTransaction({
  transactionId: agendadoId,
  accountId: contaId,
  amountCents: 17547,
  date: daquiUmMes,
  method: "PIX",
});
const gastoDepois = (await getMonthSummary(mesFuturo)).expenseCents;
check("quitar nÃ£o duplica o gasto", gastoDepois, gastoAntes);
check(
  "sai da lista de a pagar depois de quitado",
  (await getBillsForMonth(mesFuturo)).some((b) => b.bill.id === `tx:${agendadoId}`),
  false,
);

console.log("\n== 8. relatÃ³rio por perÃ­odo arbitrÃ¡rio ==");
/*
 * Toda agregaÃ§Ã£o do app era por mÃªs, o que impedia relatÃ³rio semanal, anual ou
 * customizado. getMonthSummary virou um caso particular de getRangeSummary.
 */
const diaBase = `${mes}-15`;
await createTransaction({
  type: "EXPENSE",
  amountCents: 5000,
  date: diaBase,
  description: `Gasto do periodo ${marca}`,
  categoryId: categoria.id,
  nature: "VISTA",
  accountId: contaId,
  incomeSourceId: null,
  method: "PIX",
  notes: null,
});

const soDoDia = await getRangeSummary(diaBase, diaBase);
check("intervalo de um dia sÃ³ encontra o gasto", soDoDia.expenseCents >= 5000, true);

const foraDoIntervalo = await getRangeSummary(`${mes}-01`, `${mes}-02`);
check(
  "intervalo que nÃ£o cobre o gasto nÃ£o o inclui",
  foraDoIntervalo.transactionCount === 0 ||
    !(await listTransactionsInRange(`${mes}-01`, `${mes}-02`)).some(
      (t) => t.description === `Gasto do periodo ${marca}`,
    ),
  true,
);

// PerÃ­odo curto agrupa por dia; perÃ­odo longo agrupa por mÃªs.
check("perÃ­odo de 1 semana agrupa por dia", (await getRangeSeries(diaBase, addDaysTeste(diaBase, 6))).bucket, "dia");
check("perÃ­odo de 1 ano agrupa por mÃªs", (await getRangeSeries(`${mes}-01`, `${Number(mes.slice(0, 4)) + 1}-01-01`)).bucket, "mes");

function addDaysTeste(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

})());



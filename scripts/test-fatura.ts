/**
 * Teste do ciclo da fatura do cartão.
 *
 * O que precisa ser verdade:
 *  1. Compra no cartão vira gasto no mês do VENCIMENTO da fatura
 *  2. A fatura aparece sozinha em Contas a pagar
 *  3. Pagar a fatura NÃO conta como despesa nova (senão dobra o mês)
 *  4. Pagar a fatura tira o dinheiro da conta e zera o cartão
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
  listAccountsWithBalance,
  listCategories,
  payCardInvoice,
  payScheduledTransaction,
} from "../src/lib/repo";

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
const categoria = listCategories()[0];

// Conta corrente com R$ 5.000 e cartão que fecha dia 25 / vence dia 5.
const contaId = createAccount({
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

const cartaoId = createAccount({
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

// Compra de R$ 300 no cartão, hoje.
createTransaction({
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

console.log("\n== 1. a compra caiu no mês do vencimento da fatura ==");
// Hoje é dia 6; fechamento dia 25 => entra na fatura que vence dia 5 do mês seguinte.
const mesFatura =
  Number(hoje.slice(8, 10)) > 25
    ? null
    : `${mes.slice(0, 4)}-${String(Number(mes.slice(5, 7)) + 1).padStart(2, "0")}`;
const faturaMes = mesFatura ?? mes;
check("fatura do cartão soma a compra", getCardInvoice(cartaoId, faturaMes), 30000);

console.log("\n== 2. a fatura aparece em Contas a pagar sozinha ==");
const contas = getBillsForMonth(faturaMes);
const fatura = contas.find((b) => b.bill.id === `card:${cartaoId}`);
check("fatura listada", fatura !== undefined, true);
check("valor da fatura", fatura?.bill.amountCents, 30000);
check("marcada como a vencer", fatura?.status, "UPCOMING");

console.log("\n== 3. saldos antes do pagamento ==");
const antes = listAccountsWithBalance(mes);
const contaAntes = antes.find((a) => a.id === contaId);
const cartaoAntes = antes.find((a) => a.id === cartaoId);
check("conta com 5.000", contaAntes?.balanceCents, 500000);
check("cartão devendo 300", cartaoAntes?.balanceCents, -30000);

const totalAntes = getMonthSummary(faturaMes).expenseCents;
console.log("   despesa do mês da fatura:", formatBRL(totalAntes));

console.log("\n== 4. pagar a fatura: transfere, não vira despesa nova ==");
payCardInvoice({
  cardId: cartaoId,
  fromAccountId: contaId,
  amountCents: 30000,
  date: `${faturaMes}-05`,
});

const totalDepois = getMonthSummary(faturaMes).expenseCents;
check("despesa do mês NÃO dobrou", totalDepois, totalAntes);

const depois = listAccountsWithBalance(mes);
const contaDepois = depois.find((a) => a.id === contaId);
const cartaoDepois = depois.find((a) => a.id === cartaoId);
check("saiu 300 da conta", contaDepois?.balanceCents, 470000);
check("cartão zerado", cartaoDepois?.balanceCents, 0);

const contasDepois = getBillsForMonth(faturaMes);
check(
  "fatura marcada como paga",
  contasDepois.find((b) => b.bill.id === `card:${cartaoId}`)?.status,
  "PAID",
);

console.log("\n== 5. fatura que já existia no cadastro entra na lista ==");
/*
 * Cadastrar um cartão informando "fatura em aberto hoje" precisa gerar uma
 * conta a pagar. Antes o valor aparecia no saldo do cartão mas não em Contas a
 * pagar — o cartão mostrava dívida e não havia nada para quitar.
 */
const cartaoComFatura = createAccount({
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

const contaCartao = listAccountsWithBalance(mes).find((a) => a.id === cartaoComFatura);
// Digitado sem sinal, guardado como dívida: pagar precisa somar em direção a zero.
check("saldo de abertura guardado como dívida", contaCartao?.balanceCents, -63199);

// Fecha dia 3 e vence dia 13: a fatura de abertura cai no mês seguinte ao
// cadastro quando a compra é feita depois do fechamento.
const mesAbertura = firstInvoiceDueDate(hoje, 3, 13).slice(0, 7);
check(
  "fatura de abertura tem o valor informado",
  getCardInvoice(cartaoComFatura, mesAbertura),
  63199,
);
check(
  "fatura de abertura aparece em Contas a pagar",
  getBillsForMonth(mesAbertura).some(
    (b) => b.bill.id === `card:${cartaoComFatura}` && b.bill.amountCents === 63199,
  ),
  true,
);

console.log("\n== 6. compromisso futuro não exige conta de origem ==");
/*
 * Boleto que vence semana que vem ainda não saiu de conta nenhuma. Exigir a
 * origem no cadastro obrigaria a inventar uma resposta, e um palpite errado é
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
check("data futura sem conta é aceita", futuroSemConta.success, true);

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
check("data de hoje sem conta é rejeitada", hojeSemConta.success, false);

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
check("data passada sem conta é rejeitada", passadoSemConta.success, false);

console.log("\n== 7. lançamento agendado aparece em Contas a pagar ==");
/*
 * O caso real: "mensalidade da faculdade, vence 09/09" lançada sem conta.
 * Antes ficava só no extrato, invisível na tela feita para responder
 * "o que eu tenho que pagar".
 */
const daquiUmMes = addMonthsToDate(hoje, 1);
const mesFuturo = daquiUmMes.slice(0, 7);

const agendadoId = createTransaction({
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

const aPagarFuturo = getBillsForMonth(mesFuturo);
const agendado = aPagarFuturo.find((b) => b.bill.id === `tx:${agendadoId}`);
check("agendado listado em Contas a pagar", agendado !== undefined, true);
check("com o valor certo", agendado?.bill.amountCents, 17547);
check("com o vencimento certo", agendado?.dueDate, daquiUmMes);

// Quitar tem que ATUALIZAR a linha, não criar outra.
const gastoAntes = getMonthSummary(mesFuturo).expenseCents;
payScheduledTransaction({
  transactionId: agendadoId,
  accountId: contaId,
  amountCents: 17547,
  date: daquiUmMes,
  method: "PIX",
});
const gastoDepois = getMonthSummary(mesFuturo).expenseCents;
check("quitar não duplica o gasto", gastoDepois, gastoAntes);
check(
  "sai da lista de a pagar depois de quitado",
  getBillsForMonth(mesFuturo).some((b) => b.bill.id === `tx:${agendadoId}`),
  false,
);

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

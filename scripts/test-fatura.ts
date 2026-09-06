/**
 * Teste do ciclo da fatura do cartão.
 *
 * O que precisa ser verdade:
 *  1. Compra no cartão vira gasto no mês do VENCIMENTO da fatura
 *  2. A fatura aparece sozinha em Contas a pagar
 *  3. Pagar a fatura NÃO conta como despesa nova (senão dobra o mês)
 *  4. Pagar a fatura tira o dinheiro da conta e zera o cartão
 */
import { currentMonth, firstInvoiceDueDate, today } from "../src/lib/dates";
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

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

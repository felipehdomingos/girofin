/**
 * Amarração de ponta a ponta — um mês inteiro de uso real.
 *
 * Os outros testes checam peças isoladas. Este simula o uso do app do jeito que
 * ele foi feito para ser usado — dois salários caindo, gastos do dia a dia no
 * débito e no pix, compras no cartão, uma parcelada, um estorno, uma conta fixa
 * e um boleto agendado — e cobra a única coisa que realmente importa no fim:
 *
 *     saldo da conta = entradas − saídas, sem sobrar nem faltar um centavo
 *
 * É aqui que aparece o erro que mais estraga controle financeiro: contar o
 * mesmo dinheiro duas vezes. A compra no cartão é gasto quando acontece; pagar
 * a fatura depois NÃO é um gasto novo, é o dinheiro saindo do lugar onde já
 * estava contado. Se essas duas coisas somarem, o mês fica com o dobro do
 * tamanho e o app passa a mentir.
 */
import { addMonthsToDate, currentMonth } from "../src/lib/dates";
import { formatBRL, splitCents } from "../src/lib/money";
import {
  createAccount,
  createBill,
  createIncomeSource,
  createTransaction,
  getBillsForMonth,
  getCardInvoice,
  getRangeByAccount,
  getRangeSummary,
  listAccountsWithBalance,
  listCategories,
  listTransactionsInRange,
  payBill,
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
const cat = listCategories()[0];

/*
 * Datas fixas dentro do mês corrente. Fixas para o teste não mudar de resultado
 * conforme o dia em que roda; dentro do mês corrente porque o status de "a
 * pagar" é relativo a hoje.
 */
const mes = currentMonth();
const dia = (d: number) => `${mes}-${String(d).padStart(2, "0")}`;
const mesSeguinte = addMonthsToDate(`${mes}-01`, 1).slice(0, 7);

// ---------------------------------------------------------------- cadastro

const conta = createAccount({
  name: `Corrente ${marca}`,
  kind: "CORRENTE",
  openingCents: 0,
  closingDay: null,
  dueDay: null,
  last4: null,
  creditLimitCents: null,
  overdraftLimitCents: 19000,
  bankIspb: null,
  bankName: null,
  logoUrl: null,
  color: "#3987e5",
});

// Fecha dia 25, vence dia 5 do mês seguinte.
const cartao = createAccount({
  name: `Cartao ${marca}`,
  kind: "CARTAO",
  openingCents: 0,
  closingDay: 25,
  dueDay: 5,
  last4: "4321",
  creditLimitCents: 500000,
  overdraftLimitCents: null,
  bankIspb: null,
  bankName: null,
  logoUrl: null,
  color: "#d95926",
});

const clt = createIncomeSource({ name: `CLT ${marca}`, kind: "CLT", color: "#3987e5" });
const pj = createIncomeSource({ name: `PJ ${marca}`, kind: "PJ", color: "#0e8a6a" });

// ---------------------------------------------------------------- o mês

console.log("\n== 1. as duas entradas caem na conta ==");

const SALARIO_CLT = 420000;
const NOTA_PJ = 310000;

for (const [fonte, valor, quando] of [
  [clt, SALARIO_CLT, dia(5)],
  [pj, NOTA_PJ, dia(15)],
] as const) {
  createTransaction({
    type: "INCOME",
    amountCents: valor,
    date: quando,
    description: `Entrada ${marca}`,
    categoryId: cat.id,
    nature: "VISTA",
    accountId: conta,
    incomeSourceId: fonte,
    method: "TRANSFERENCIA",
    notes: null,
  });
}

const saldoInicial = listAccountsWithBalance(mes).find((a) => a.id === conta);
check("conta recebeu os dois salários", saldoInicial?.balanceCents, SALARIO_CLT + NOTA_PJ);

console.log("\n== 2. gastos do dia a dia saem da conta ==");

/*
 * O caso de uso central: lançar todo dia. Débito e pix saem da conta na hora —
 * é o que separa dinheiro que já foi de dinheiro que ainda vai.
 */
const DIARIOS: Array<[number, number, "DEBITO" | "PIX"]> = [
  [6, 4590, "DEBITO"],
  [7, 12000, "PIX"],
  [8, 3250, "DEBITO"],
  [12, 8790, "PIX"],
  [20, 15630, "DEBITO"],
];
const TOTAL_DIARIO = DIARIOS.reduce((a, [, v]) => a + v, 0);

for (const [d, valor, forma] of DIARIOS) {
  createTransaction({
    type: "EXPENSE",
    amountCents: valor,
    date: dia(d),
    description: `Gasto dia ${d} ${marca}`,
    categoryId: cat.id,
    nature: "VISTA",
    accountId: conta,
    incomeSourceId: null,
    method: forma,
    notes: null,
  });
}

const aposDiarios = listAccountsWithBalance(mes).find((a) => a.id === conta);
check(
  "saldo desceu exatamente o que foi gasto",
  aposDiarios?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO,
);

console.log("\n== 3. conta fixa quitada ==");

/*
 * Conta fixa é gasto do mês como qualquer outro — o que muda é só ela já estar
 * cadastrada. Se quitar não descontasse da conta, o saldo do app ficaria acima
 * do saldo do banco justamente nas contas mais previsíveis.
 */
const ALUGUEL = 150000;
const boletoFixo = createBill({
  name: `Aluguel ${marca}`,
  recurrence: "MONTHLY",
  amountCents: ALUGUEL,
  dueDay: 10,
  dueDate: null,
  categoryId: cat.id,
  variable: false,
  active: true,
  barcode: null,
  notes: null,
});

check(
  "conta fixa aparece em Contas a pagar",
  getBillsForMonth(mes).some((b) => b.bill.id === boletoFixo),
  true,
);

payBill({ billId: boletoFixo, amountCents: ALUGUEL, date: dia(10), accountId: conta, notes: null });

check(
  "sai da lista depois de quitada",
  getBillsForMonth(mes).find((b) => b.bill.id === boletoFixo)?.status,
  "PAID",
);

const aposFixa = listAccountsWithBalance(mes).find((a) => a.id === conta);
check(
  "quitar a conta fixa saiu do saldo",
  aposFixa?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL,
);

console.log("\n== 4. cartão: compra à vista, parcelada e estorno ==");

/*
 * Compra no cartão NÃO sai da conta agora — ela entra na fatura. É o que o
 * cartão faz de diferente de tudo o mais, e é o que a maioria dos controles
 * erra: ou tira o dinheiro cedo demais, ou nunca tira.
 */
const COMPRA_VISTA = 25000;
createTransaction({
  type: "EXPENSE",
  amountCents: COMPRA_VISTA,
  date: dia(10),
  description: `Compra cartao ${marca}`,
  categoryId: cat.id,
  nature: "VISTA",
  accountId: cartao,
  incomeSourceId: null,
  method: "CREDITO",
  notes: null,
});

// Parcelada em 3x de um valor que não divide redondo: 100,00 / 3.
const PARCELADA_TOTAL = 10000;
const PARCELAS = splitCents(PARCELADA_TOTAL, 3);
createTransaction({
  type: "EXPENSE",
  amountCents: PARCELADA_TOTAL,
  date: dia(10),
  description: `Parcelada ${marca}`,
  categoryId: cat.id,
  nature: "PARCELADO",
  installments: 3,
  accountId: cartao,
  incomeSourceId: null,
  method: "CREDITO",
  notes: null,
});

check("parcelas somam o total, sem perder centavo", PARCELAS.reduce((a, b) => a + b, 0), PARCELADA_TOTAL);
check("a divisão desigual fica no começo", PARCELAS, [3334, 3333, 3333]);

/*
 * Estorno: a loja devolveu. Entra como ENTRADA no cartão porque é exatamente
 * isso que acontece — o valor volta para o limite e abate a fatura. É assim que
 * a fatura importada do Itaú fecha nos R$ 3.059,44 que o banco cobra, em vez de
 * nos R$ 3.209,62 que foram comprados.
 */
const ESTORNO = 4000;
createTransaction({
  type: "INCOME",
  amountCents: ESTORNO,
  date: dia(12),
  description: `Estorno ${marca}`,
  categoryId: cat.id,
  nature: "VISTA",
  accountId: cartao,
  incomeSourceId: null,
  method: "CREDITO",
  notes: null,
});

// Compras do dia 10 fecham no dia 25 e vencem dia 5 do mês seguinte.
const FATURA = COMPRA_VISTA + PARCELAS[0] - ESTORNO;
check("fatura = compras − estorno", getCardInvoice(cartao, mesSeguinte), FATURA);

/*
 * O saldo do cartão é a dívida INTEIRA, não só a fatura do mês: as parcelas que
 * ainda vão vencer já foram compradas e já comprometem o limite. É a diferença
 * entre "quanto pago dia 5" e "quanto ainda devo neste cartão".
 */
const DIVIDA_TOTAL = COMPRA_VISTA + PARCELADA_TOTAL - ESTORNO;
const cartaoAntes = listAccountsWithBalance(mes).find((a) => a.id === cartao);
check("saldo do cartão é a dívida inteira", cartaoAntes?.balanceCents, -DIVIDA_TOTAL);

check(
  "as outras 2 parcelas ficaram nos meses seguintes",
  [
    getCardInvoice(cartao, addMonthsToDate(`${mesSeguinte}-01`, 1).slice(0, 7)),
    getCardInvoice(cartao, addMonthsToDate(`${mesSeguinte}-01`, 2).slice(0, 7)),
  ],
  [PARCELAS[1], PARCELAS[2]],
);

console.log("\n== 5. boleto agendado para o futuro ==");

/*
 * Boleto que vence mês que vem ainda não saiu de conta nenhuma. Ele precisa
 * aparecer em Contas a pagar sem mexer no saldo de hoje — quem paga antes da
 * hora está olhando um saldo que não existe.
 */
const FACULDADE = 17531;
const vencimento = `${mesSeguinte}-09`;
const agendado = createTransaction({
  type: "EXPENSE",
  amountCents: FACULDADE,
  date: vencimento,
  description: `Faculdade ${marca}`,
  categoryId: cat.id,
  nature: "VISTA",
  accountId: null,
  incomeSourceId: null,
  method: null,
  notes: null,
});

const saldoComAgendado = listAccountsWithBalance(mes).find((a) => a.id === conta);
check(
  "agendado não mexe no saldo de hoje",
  saldoComAgendado?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL,
);
check(
  "mas já aparece em Contas a pagar do mês que vem",
  getBillsForMonth(mesSeguinte).some((b) => b.bill.id === `tx:${agendado}`),
  true,
);

console.log("\n== 6. o mês fecha ==");

/*
 * Somado só o que este teste criou: o banco de teste é compartilhado com os
 * outros arquivos, e um total global mediria o lixo deles junto.
 */
function meus(de: string, ate: string, daConta?: string) {
  const linhas = listTransactionsInRange(de, ate).filter(
    (t) => t.description.includes(marca) && (!daConta || t.accountId === daConta),
  );
  const soma = (tipo: "INCOME" | "EXPENSE") =>
    linhas.filter((t) => t.type === tipo).reduce((a, t) => a + t.amountCents, 0);
  return { entrada: soma("INCOME"), saida: soma("EXPENSE") };
}

const esteMes = meus(dia(1), dia(28));
check("entradas do mês são os dois salários", esteMes.entrada, SALARIO_CLT + NOTA_PJ);
check("saídas do mês são só o que saiu da conta", esteMes.saida, TOTAL_DIARIO + ALUGUEL);

/*
 * A compra no cartão é gasto do mês em que a FATURA vence — não do dia da
 * compra. É o que impede o mês da compra de parecer estourado e o mês do
 * pagamento de parecer barato.
 */
const mesDaFatura = meus(`${mesSeguinte}-01`, `${mesSeguinte}-28`, cartao);
check("compras do cartão viraram gasto no mês da fatura", mesDaFatura.saida, COMPRA_VISTA + PARCELAS[0]);
check("o estorno acompanhou a fatura da compra", mesDaFatura.entrada, ESTORNO);

console.log("   sobra do mês:", formatBRL(esteMes.entrada - esteMes.saida));

/*
 * Cada gasto tem dono. Um lançamento sem conta some do rateio e o usuário nunca
 * descobre por quê — foi essa amarração que motivou "sempre amarre tudo para
 * fechar certinho no final as contas".
 */
const porConta = getRangeByAccount(dia(1), dia(28));
const semDono = listTransactionsInRange(dia(1), dia(28)).filter(
  (t) => t.description.includes(marca) && !t.accountId,
);
check("nenhum gasto do mês ficou sem conta", semDono.length, 0);
check(
  "o rateio por conta cobre a conta corrente",
  porConta.find((r) => r.name === `Corrente ${marca}`)?.totalCents,
  TOTAL_DIARIO + ALUGUEL,
);

console.log("\n== 7. pagar a fatura não conta o dinheiro duas vezes ==");

const gastoAntesDoPagamento = getRangeSummary(`${mesSeguinte}-01`, `${mesSeguinte}-28`).expenseCents;

payCardInvoice({
  cardId: cartao,
  fromAccountId: conta,
  amountCents: FATURA,
  date: `${mesSeguinte}-05`,
});

check(
  "o mês da fatura não engordou ao pagar",
  getRangeSummary(`${mesSeguinte}-01`, `${mesSeguinte}-28`).expenseCents,
  gastoAntesDoPagamento,
);

const finais = listAccountsWithBalance(mes);
check(
  "no cartão sobra só o que ainda vai vencer",
  finais.find((a) => a.id === cartao)?.balanceCents,
  -(PARCELAS[1] + PARCELAS[2]),
);

/*
 * O fechamento de tudo: o saldo da conta é exatamente entradas menos tudo o que
 * saiu de verdade — incluindo a fatura, que saiu agora, e excluindo o agendado,
 * que ainda não saiu.
 */
const ESPERADO = SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL - FATURA;
check("saldo final da conta bate na unha", finais.find((a) => a.id === conta)?.balanceCents, ESPERADO);

console.log("\n== 8. quitar o agendado fecha o ciclo ==");

payScheduledTransaction({
  transactionId: agendado,
  accountId: conta,
  amountCents: FACULDADE,
  date: vencimento,
  method: "BOLETO",
});

check(
  "saiu de Contas a pagar",
  getBillsForMonth(mesSeguinte).some((b) => b.bill.id === `tx:${agendado}`),
  false,
);
check(
  "e só agora saiu do saldo",
  listAccountsWithBalance(mes).find((a) => a.id === conta)?.balanceCents,
  ESPERADO - FACULDADE,
);

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

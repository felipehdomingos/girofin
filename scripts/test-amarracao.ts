/**
 * AmarraÃ§Ã£o de ponta a ponta â€” um mÃªs inteiro de uso real.
 *
 * Os outros testes checam peÃ§as isoladas. Este simula o uso do app do jeito que
 * ele foi feito para ser usado â€” dois salÃ¡rios caindo, gastos do dia a dia no
 * dÃ©bito e no pix, compras no cartÃ£o, uma parcelada, um estorno, uma conta fixa
 * e um boleto agendado â€” e cobra a Ãºnica coisa que realmente importa no fim:
 *
 *     saldo da conta = entradas âˆ’ saÃ­das, sem sobrar nem faltar um centavo
 *
 * Ã‰ aqui que aparece o erro que mais estraga controle financeiro: contar o
 * mesmo dinheiro duas vezes. A compra no cartÃ£o Ã© gasto quando acontece; pagar
 * a fatura depois NÃƒO Ã© um gasto novo, Ã© o dinheiro saindo do lugar onde jÃ¡
 * estava contado. Se essas duas coisas somarem, o mÃªs fica com o dobro do
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
const cat = (await listCategories())[0];

/*
 * Datas fixas dentro do mÃªs corrente. Fixas para o teste nÃ£o mudar de resultado
 * conforme o dia em que roda; dentro do mÃªs corrente porque o status de "a
 * pagar" Ã© relativo a hoje.
 */
const mes = currentMonth();
const dia = (d: number) => `${mes}-${String(d).padStart(2, "0")}`;
const mesSeguinte = addMonthsToDate(`${mes}-01`, 1).slice(0, 7);

// ---------------------------------------------------------------- cadastro

const conta = await createAccount({
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

// Fecha dia 25, vence dia 5 do mÃªs seguinte.
const cartao = await createAccount({
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

const clt = await createIncomeSource({ name: `CLT ${marca}`, kind: "CLT", color: "#3987e5" });
const pj = await createIncomeSource({ name: `PJ ${marca}`, kind: "PJ", color: "#0e8a6a" });

// ---------------------------------------------------------------- o mÃªs

console.log("\n== 1. as duas entradas caem na conta ==");

const SALARIO_CLT = 420000;
const NOTA_PJ = 310000;

for (const [fonte, valor, quando] of [
  [clt, SALARIO_CLT, dia(5)],
  [pj, NOTA_PJ, dia(15)],
] as const) {
  await createTransaction({
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

const saldoInicial = (await listAccountsWithBalance(mes)).find((a) => a.id === conta);
check("conta recebeu os dois salÃ¡rios", saldoInicial?.balanceCents, SALARIO_CLT + NOTA_PJ);

console.log("\n== 2. gastos do dia a dia saem da conta ==");

/*
 * O caso de uso central: lanÃ§ar todo dia. DÃ©bito e pix saem da conta na hora â€”
 * Ã© o que separa dinheiro que jÃ¡ foi de dinheiro que ainda vai.
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
  await createTransaction({
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

const aposDiarios = (await listAccountsWithBalance(mes)).find((a) => a.id === conta);
check(
  "saldo desceu exatamente o que foi gasto",
  aposDiarios?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO,
);

console.log("\n== 3. conta fixa quitada ==");

/*
 * Conta fixa Ã© gasto do mÃªs como qualquer outro â€” o que muda Ã© sÃ³ ela jÃ¡ estar
 * cadastrada. Se quitar nÃ£o descontasse da conta, o saldo do app ficaria acima
 * do saldo do banco justamente nas contas mais previsÃ­veis.
 */
const ALUGUEL = 150000;
const boletoFixo = await createBill({
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
  (await getBillsForMonth(mes)).some((b) => b.bill.id === boletoFixo),
  true,
);

await payBill({ billId: boletoFixo, amountCents: ALUGUEL, date: dia(10), accountId: conta, notes: null });

check(
  "sai da lista depois de quitada",
  (await getBillsForMonth(mes)).find((b) => b.bill.id === boletoFixo)?.status,
  "PAID",
);

const aposFixa = (await listAccountsWithBalance(mes)).find((a) => a.id === conta);
check(
  "quitar a conta fixa saiu do saldo",
  aposFixa?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL,
);

console.log("\n== 4. cartÃ£o: compra Ã  vista, parcelada e estorno ==");

/*
 * Compra no cartÃ£o NÃƒO sai da conta agora â€” ela entra na fatura. Ã‰ o que o
 * cartÃ£o faz de diferente de tudo o mais, e Ã© o que a maioria dos controles
 * erra: ou tira o dinheiro cedo demais, ou nunca tira.
 */
const COMPRA_VISTA = 25000;
await createTransaction({
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

// Parcelada em 3x de um valor que nÃ£o divide redondo: 100,00 / 3.
const PARCELADA_TOTAL = 10000;
const PARCELAS = splitCents(PARCELADA_TOTAL, 3);
await createTransaction({
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
check("a divisÃ£o desigual fica no comeÃ§o", PARCELAS, [3334, 3333, 3333]);

/*
 * Estorno: a loja devolveu. Entra como ENTRADA no cartÃ£o porque Ã© exatamente
 * isso que acontece â€” o valor volta para o limite e abate a fatura. Ã‰ assim que
 * a fatura importada do ItaÃº fecha nos R$ 3.059,44 que o banco cobra, em vez de
 * nos R$ 3.209,62 que foram comprados.
 */
const ESTORNO = 4000;
await createTransaction({
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

// Compras do dia 10 fecham no dia 25 e vencem dia 5 do mÃªs seguinte.
const FATURA = COMPRA_VISTA + PARCELAS[0] - ESTORNO;
check("fatura = compras âˆ’ estorno", await getCardInvoice(cartao, mesSeguinte), FATURA);

/*
 * O saldo do cartÃ£o Ã© a dÃ­vida INTEIRA, nÃ£o sÃ³ a fatura do mÃªs: as parcelas que
 * ainda vÃ£o vencer jÃ¡ foram compradas e jÃ¡ comprometem o limite. Ã‰ a diferenÃ§a
 * entre "quanto pago dia 5" e "quanto ainda devo neste cartÃ£o".
 */
const DIVIDA_TOTAL = COMPRA_VISTA + PARCELADA_TOTAL - ESTORNO;
const cartaoAntes = (await listAccountsWithBalance(mes)).find((a) => a.id === cartao);
check("saldo do cartÃ£o Ã© a dÃ­vida inteira", cartaoAntes?.balanceCents, -DIVIDA_TOTAL);

check(
  "as outras 2 parcelas ficaram nos meses seguintes",
  [
    await getCardInvoice(cartao, addMonthsToDate(`${mesSeguinte}-01`, 1).slice(0, 7)),
    await getCardInvoice(cartao, addMonthsToDate(`${mesSeguinte}-01`, 2).slice(0, 7)),
  ],
  [PARCELAS[1], PARCELAS[2]],
);

console.log("\n== 5. boleto agendado para o futuro ==");

/*
 * Boleto que vence mÃªs que vem ainda nÃ£o saiu de conta nenhuma. Ele precisa
 * aparecer em Contas a pagar sem mexer no saldo de hoje â€” quem paga antes da
 * hora estÃ¡ olhando um saldo que nÃ£o existe.
 */
const FACULDADE = 17531;
const vencimento = `${mesSeguinte}-09`;
const agendado = await createTransaction({
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

const saldoComAgendado = (await listAccountsWithBalance(mes)).find((a) => a.id === conta);
check(
  "agendado nÃ£o mexe no saldo de hoje",
  saldoComAgendado?.balanceCents,
  SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL,
);
check(
  "mas jÃ¡ aparece em Contas a pagar do mÃªs que vem",
  (await getBillsForMonth(mesSeguinte)).some((b) => b.bill.id === `tx:${agendado}`),
  true,
);

console.log("\n== 6. o mÃªs fecha ==");

/*
 * Somado sÃ³ o que este teste criou: o banco de teste Ã© compartilhado com os
 * outros arquivos, e um total global mediria o lixo deles junto.
 */
async function meus(de: string, ate: string, daConta?: string) {
  const linhas = (await listTransactionsInRange(de, ate)).filter(
    (t) => t.description.includes(marca) && (!daConta || t.accountId === daConta),
  );
  const soma = (tipo: "INCOME" | "EXPENSE") =>
    linhas.filter((t) => t.type === tipo).reduce((a, t) => a + t.amountCents, 0);
  return { entrada: soma("INCOME"), saida: soma("EXPENSE") };
}

const esteMes = await meus(dia(1), dia(28));
check("entradas do mÃªs sÃ£o os dois salÃ¡rios", esteMes.entrada, SALARIO_CLT + NOTA_PJ);
check("saÃ­das do mÃªs sÃ£o sÃ³ o que saiu da conta", esteMes.saida, TOTAL_DIARIO + ALUGUEL);

/*
 * A compra no cartÃ£o Ã© gasto do mÃªs em que a FATURA vence â€” nÃ£o do dia da
 * compra. Ã‰ o que impede o mÃªs da compra de parecer estourado e o mÃªs do
 * pagamento de parecer barato.
 */
const mesDaFatura = await meus(`${mesSeguinte}-01`, `${mesSeguinte}-28`, cartao);
check("compras do cartÃ£o viraram gasto no mÃªs da fatura", mesDaFatura.saida, COMPRA_VISTA + PARCELAS[0]);
check("o estorno acompanhou a fatura da compra", mesDaFatura.entrada, ESTORNO);

console.log("   sobra do mÃªs:", formatBRL(esteMes.entrada - esteMes.saida));

/*
 * Cada gasto tem dono. Um lanÃ§amento sem conta some do rateio e o usuÃ¡rio nunca
 * descobre por quÃª â€” foi essa amarraÃ§Ã£o que motivou "sempre amarre tudo para
 * fechar certinho no final as contas".
 */
const porConta = await getRangeByAccount(dia(1), dia(28));
const semDono = (await listTransactionsInRange(dia(1), dia(28))).filter(
  (t) => t.description.includes(marca) && !t.accountId,
);
check("nenhum gasto do mÃªs ficou sem conta", semDono.length, 0);
check(
  "o rateio por conta cobre a conta corrente",
  porConta.find((r) => r.name === `Corrente ${marca}`)?.totalCents,
  TOTAL_DIARIO + ALUGUEL,
);

console.log("\n== 7. pagar a fatura nÃ£o conta o dinheiro duas vezes ==");

const gastoAntesDoPagamento = (await getRangeSummary(`${mesSeguinte}-01`, `${mesSeguinte}-28`)).expenseCents;

await payCardInvoice({
  cardId: cartao,
  fromAccountId: conta,
  amountCents: FATURA,
  date: `${mesSeguinte}-05`,
});

check(
  "o mÃªs da fatura nÃ£o engordou ao pagar",
  (await getRangeSummary(`${mesSeguinte}-01`, `${mesSeguinte}-28`)).expenseCents,
  gastoAntesDoPagamento,
);

const finais = await listAccountsWithBalance(mes);
check(
  "no cartÃ£o sobra sÃ³ o que ainda vai vencer",
  finais.find((a) => a.id === cartao)?.balanceCents,
  -(PARCELAS[1] + PARCELAS[2]),
);

/*
 * O fechamento de tudo: o saldo da conta Ã© exatamente entradas menos tudo o que
 * saiu de verdade â€” incluindo a fatura, que saiu agora, e excluindo o agendado,
 * que ainda nÃ£o saiu.
 */
const ESPERADO = SALARIO_CLT + NOTA_PJ - TOTAL_DIARIO - ALUGUEL - FATURA;
check("saldo final da conta bate na unha", finais.find((a) => a.id === conta)?.balanceCents, ESPERADO);

console.log("\n== 8. quitar o agendado fecha o ciclo ==");

await payScheduledTransaction({
  transactionId: agendado,
  accountId: conta,
  amountCents: FACULDADE,
  date: vencimento,
  method: "BOLETO",
});

check(
  "saiu de Contas a pagar",
  (await getBillsForMonth(mesSeguinte)).some((b) => b.bill.id === `tx:${agendado}`),
  false,
);
check(
  "e sÃ³ agora saiu do saldo",
  (await listAccountsWithBalance(mes)).find((a) => a.id === conta)?.balanceCents,
  ESPERADO - FACULDADE,
);

console.log(`\n${ok} passaram, ${fail} falharam\n`);
if (fail > 0) process.exit(1);

})());



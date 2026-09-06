/** Classificação 50/30/20 — o eixo que o motor de recomendação usa. */
export type CategoryKind = "NEED" | "WANT" | "SAVE";

export type TxType = "INCOME" | "EXPENSE";

/**
 * Natureza do gasto — como ele se comporta no tempo.
 *
 * Não é rótulo decorativo: cada valor muda o que o app faz com o lançamento.
 * FIXO entra na conta de custo recorrente e vira candidato a corte;
 * PARCELADO gera uma linha por mês em vez de um valor único.
 */
export type TxNature = "FIXO" | "VISTA" | "PARCELADO";

export const NATURE_LABEL: Record<TxNature, string> = {
  FIXO: "Custo fixo",
  VISTA: "À vista",
  PARCELADO: "Parcelado",
};

/**
 * Como foi pago. Eixo INDEPENDENTE de `nature`: um pix é à vista, uma compra no
 * crédito pode ser parcelada, e um boleto pode ser custo fixo. Juntar os dois
 * num campo só obrigaria a inventar combinações ("pix parcelado") que não existem.
 */
export type PaymentMethod =
  | "PIX"
  | "DEBITO"
  | "CREDITO"
  | "DINHEIRO"
  | "BOLETO"
  | "TRANSFERENCIA";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: "Pix",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  DINHEIRO: "Dinheiro",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
};

/**
 * Quais tipos de conta cada forma de pagamento aceita.
 *
 * É o que faz o caixa fechar: crédito sai de cartão, débito e pix saem de conta
 * bancária, dinheiro sai da carteira. Sem esse amarrado, dá para lançar um pix
 * saindo de um cartão de crédito — e aí o saldo de nenhum dos dois bate com a
 * realidade.
 */
export const METHOD_ACCOUNT_KINDS: Record<PaymentMethod, AccountKind[]> = {
  CREDITO: ["CARTAO"],
  DEBITO: ["CORRENTE", "POUPANCA"],
  PIX: ["CORRENTE", "POUPANCA"],
  TRANSFERENCIA: ["CORRENTE", "POUPANCA", "INVESTIMENTO"],
  DINHEIRO: ["CARTEIRA"],
  BOLETO: ["CORRENTE", "POUPANCA", "CARTEIRA"],
};

/** Rótulo do campo de conta, específico por forma de pagamento. */
export const METHOD_ACCOUNT_LABEL: Record<PaymentMethod, string> = {
  CREDITO: "Qual cartão",
  DEBITO: "De qual conta",
  PIX: "De qual conta",
  TRANSFERENCIA: "De qual conta",
  DINHEIRO: "De qual carteira",
  BOLETO: "Pago por qual conta",
};

export const KIND_LABEL: Record<CategoryKind, string> = {
  NEED: "Essencial",
  WANT: "Desejo",
  SAVE: "Poupança",
};

/** Alvo da regra 50/30/20, em % da renda líquida. */
export const KIND_TARGET: Record<CategoryKind, number> = {
  NEED: 50,
  WANT: 30,
  SAVE: 20,
};

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetCents: number | null;
  archived: boolean;
}

export interface Transaction {
  id: string;
  type: TxType;
  /**
   * Sempre positivo. O sinal vem de `type`.
   * Em lançamento PARCELADO, este é o valor DA PARCELA, não o da compra —
   * cada parcela é uma linha, e a soma do mês tem que bater com o que saiu
   * do bolso naquele mês.
   */
  amountCents: number;
  /** ISO "YYYY-MM-DD". Data pura, sem hora e sem fuso — ver lib/dates.ts. */
  date: string;
  description: string;
  nature: TxNature;
  notes: string | null;
  categoryId: string;
  /** Como foi pago. null quando não informado. */
  method: PaymentMethod | null;
  /** Une as parcelas de uma mesma compra. null quando não é parcelado. */
  purchaseId: string | null;
  /** 1-based: a 2ª de 6 tem installmentNo = 2. */
  installmentNo: number | null;
  installmentTotal: number | null;
  /** Carteira de onde saiu / para onde entrou. Opcional. */
  accountId: string | null;
  /** Só em entradas: qual emprego/fonte gerou a receita. */
  incomeSourceId: string | null;
  /**
   * Dia da compra, quando difere do dia em que o dinheiro sai.
   * Em compra no cartão, `date` é o vencimento da fatura e este é o dia da
   * compra. null quando os dois coincidem.
   */
  purchaseDate: string | null;
}

export type AccountKind =
  | "CORRENTE"
  | "POUPANCA"
  | "CARTEIRA"
  | "INVESTIMENTO"
  | "CARTAO";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  CORRENTE: "Conta corrente",
  POUPANCA: "Poupança",
  CARTEIRA: "Dinheiro / carteira",
  INVESTIMENTO: "Investimento",
  CARTAO: "Cartão de crédito",
};

/** Onde o dinheiro está. */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Saldo no dia do cadastro. O saldo atual é sempre calculado. */
  openingCents: number;
  /** Dia do fechamento da fatura. Só em kind === "CARTAO". */
  closingDay: number | null;
  /** Dia do vencimento da fatura. Só em kind === "CARTAO". */
  dueDay: number | null;
  /** 4 últimos dígitos do cartão. Nunca o número completo. */
  last4: string | null;
  /** Limite total do cartão, em centavos. Só em kind === "CARTAO". */
  creditLimitCents: number | null;
  /** Identificação do banco na base do Banco Central. */
  bankIspb: string | null;
  bankName: string | null;
  /** URL do SVG do logo, quando o banco tem. */
  logoUrl: string | null;
  color: string;
  archived: boolean;
}

export interface AccountWithBalance extends Account {
  /** openingCents + entradas − saídas. Nunca é lido do banco. */
  balanceCents: number;
  /** Movimentação do mês corrente, para contexto. */
  monthInCents: number;
  monthOutCents: number;
}

export type IncomeKind = "CLT" | "PJ" | "OUTRO";

export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  CLT: "CLT",
  PJ: "PJ",
  OUTRO: "Outra",
};

export interface IncomeSource {
  id: string;
  name: string;
  kind: IncomeKind;
  color: string;
  archived: boolean;
}

export interface IncomeSourceTotal {
  source: IncomeSource;
  totalCents: number;
  share: number;
}

/** Lançamento já com a categoria resolvida, para renderizar sem N+1. */
export interface TransactionWithCategory extends Transaction {
  category: Category;
  /** Nome da carteira, quando houver. Resolvido no mesmo JOIN. */
  accountName: string | null;
  incomeSourceName: string | null;
}

export interface Goal {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
  archived: boolean;
}

export type Recurrence = "MONTHLY" | "ONCE";

/** Conta a pagar: fixa mensal ou boleto avulso. */
export interface Bill {
  id: string;
  name: string;
  recurrence: Recurrence;
  amountCents: number;
  /** 1-31, quando recurrence === "MONTHLY". */
  dueDay: number | null;
  /** "YYYY-MM-DD", quando recurrence === "ONCE". */
  dueDate: string | null;
  categoryId: string;
  variable: boolean;
  active: boolean;
  barcode: string | null;
  notes: string | null;
}

export type BillStatus = "PAID" | "DUE_TODAY" | "UPCOMING" | "OVERDUE";

/** Conta resolvida para um mês específico: quanto, quando e se já foi paga. */
export interface BillInMonth {
  bill: Bill;
  category: Category;
  /** Vencimento efetivo no mês consultado, "YYYY-MM-DD". */
  dueDate: string;
  status: BillStatus;
  /** Valor realmente pago; null enquanto em aberto. */
  paidCents: number | null;
  /** Lançamento que quitou a conta, quando existe. */
  paidTransactionId: string | null;
  /** Negativo = atrasada há N dias. Positivo = vence em N dias. */
  daysUntilDue: number;
}

export type RateSource = "CDI" | "SELIC" | "POUPANCA" | "CUSTOM";

export interface Scenario {
  id: string;
  name: string;
  initialCents: number;
  monthlyCents: number;
  months: number;
  rateSource: RateSource;
  /** Ex.: 100 = 100% do CDI, 110 = 110% do CDI. */
  ratePercentOfIndex: number;
  /** % ao ano, usado quando rateSource === "CUSTOM". */
  customAnnualRate: number;
  showReal: boolean;
}

/** Resumo mensal — a base de quase toda tela. */
export interface MonthSummary {
  /** "YYYY-MM" */
  month: string;
  incomeCents: number;
  expenseCents: number;
  /** income - expense. Negativo = mês no vermelho. */
  balanceCents: number;
  byKind: Record<CategoryKind, number>;
  byCategory: CategoryTotal[];
  transactionCount: number;
  /** Renda separada por fonte — CLT x PJ x resto. */
  byIncomeSource: IncomeSourceTotal[];
  /** Quanto das saídas do mês é parcela de compra antiga. */
  installmentCents: number;
  /** Quanto das saídas do mês é custo fixo. */
  fixedCents: number;
}

export interface CategoryTotal {
  category: Category;
  totalCents: number;
  /** % do total de despesas do mês. */
  share: number;
  budgetCents: number | null;
  /** % do orçamento consumido; null quando não há orçamento definido. */
  budgetUsedPct: number | null;
}

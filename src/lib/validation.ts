import { z } from "zod";

import { parseBRLToCents } from "./money";

/**
 * Validação na fronteira. Server Action é endpoint público — dá para chamar por
 * POST direto, sem passar pelo formulário. Toda entrada é validada aqui antes
 * de encostar no banco, não importa quão "interno" o app pareça.
 * (Guideline nextjs/Security: "Validate Server Action input", severidade High.)
 */

/** Aceita o que a pessoa digita ("1.234,56", "R$ 89,90") e devolve centavos. */
const moneyField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Informe o valor de ${label}.`)
    .transform((v, ctx) => {
      const cents = parseBRLToCents(v);
      if (cents === null) {
        ctx.addIssue({
          code: "custom",
          message: `Valor inválido. Use o formato 1.234,56.`,
        });
        return z.NEVER;
      }
      if (cents <= 0) {
        ctx.addIssue({ code: "custom", message: `O valor precisa ser maior que zero.` });
        return z.NEVER;
      }
      return cents;
    });

/**
 * Hoje como "YYYY-MM-DD", no fuso local.
 *
 * Duplica o `today()` de dates.ts de propósito: validation.ts é importado por
 * componentes de cliente, e dates.ts não tem dependência de servidor — mas
 * manter a importação cruzada aqui puxaria a árvore inteira para o bundle.
 * São três linhas; a comparação é sempre string contra string.
 */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    // Rejeita 31/02: o Date normaliza para 03/03 e a data volta diferente.
    return dt.getMonth() === m - 1 && dt.getDate() === day;
  }, "Essa data não existe.");

export const transactionSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: moneyField("lançamento"),
    date: isoDate,
    description: z.string().trim().min(1, "Descreva o lançamento.").max(120),
    categoryId: z.string().min(1, "Escolha uma categoria."),
    nature: z.enum(["FIXO", "VISTA", "PARCELADO"]).default("VISTA"),
    // Teto de 72: acima disso é erro de digitação, não compra.
    installments: z.coerce.number().int().min(1).max(72).optional(),
    /**
     * Se o valor digitado é o total da compra ou o de cada parcela.
     * As duas formas são usadas no Brasil ("1.200 em 6x" e "6x de 200"),
     * e adivinhar erraria metade das vezes.
     */
    amountMode: z.enum(["TOTAL", "PARCELA"]).default("TOTAL"),
    accountId: z.string().optional().nullable(),
    incomeSourceId: z.string().optional().nullable(),
    method: z
      .enum(["PIX", "DEBITO", "CREDITO", "DINHEIRO", "BOLETO", "TRANSFERENCIA"])
      .optional()
      .nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (v) => v.nature !== "PARCELADO" || (v.installments ?? 0) >= 2,
    { message: "Parcelado precisa de 2 parcelas ou mais.", path: ["installments"] },
  )
  /*
   * Conta obrigatória — mas só quando o dinheiro JÁ se moveu.
   *
   * A regra existe para o caixa fechar: um gasto sem conta não pertence a
   * lugar nenhum, e a soma das contas passa a divergir do total do mês.
   *
   * Só que ela não pode valer para data FUTURA. Um boleto que vence semana que
   * vem ainda não saiu de conta nenhuma — exigir a origem no cadastro obriga a
   * inventar uma resposta, e um palpite errado é pior que campo vazio: ele
   * some do saldo de uma conta que nunca pagou aquilo.
   *
   * Data futura = compromisso agendado, origem opcional.
   * Data de hoje ou passada = o dinheiro saiu, origem obrigatória.
   */
  .refine((v) => v.type !== "EXPENSE" || v.date > hojeIso() || !!v.method, {
    message: "Informe a forma de pagamento.",
    path: ["method"],
  })
  .refine((v) => v.date > hojeIso() || !!v.accountId, {
    message: "Escolha a conta ou o cartão deste lançamento.",
    path: ["accountId"],
  });

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(40),
  kind: z.enum(["NEED", "WANT", "SAVE"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."),
  icon: z.string().trim().min(1).max(40).default("circle"),
  // Orçamento é opcional: campo vazio significa "sem teto", não "teto zero".
  budget: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? parseBRLToCents(v) : null)),
});

export const billSchema = z
  .object({
    name: z.string().trim().min(2, "Nome muito curto.").max(60),
    recurrence: z.enum(["MONTHLY", "ONCE"]),
    amount: moneyField("conta"),
    dueDay: z.coerce.number().int().min(1).max(31).optional(),
    dueDate: isoDate.optional(),
    categoryId: z.string().min(1, "Escolha uma categoria."),
    variable: z.coerce.boolean().default(false),
    barcode: z.string().trim().max(60).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  // Espelha o CHECK do banco: cada recorrência exige o seu campo de vencimento.
  // Validar aqui dá mensagem legível; o CHECK é a rede de segurança.
  .refine((v) => v.recurrence !== "MONTHLY" || v.dueDay !== undefined, {
    message: "Informe o dia do vencimento.",
    path: ["dueDay"],
  })
  .refine((v) => v.recurrence !== "ONCE" || v.dueDate !== undefined, {
    message: "Informe a data de vencimento.",
    path: ["dueDate"],
  });

export const payBillSchema = z.object({
  billId: z.string().min(1),
  amount: moneyField("pagamento"),
  date: isoDate,
  accountId: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const accountSchema = z
  .object({
  name: z.string().trim().min(2, "Nome muito curto.").max(40),
  kind: z.enum(["CORRENTE", "POUPANCA", "CARTEIRA", "INVESTIMENTO", "CARTAO"]),
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  // Exatamente 4 dígitos. Nunca o número completo do cartão.
  last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Informe os 4 últimos dígitos.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Limite do cartão. Opcional: nem todo mundo sabe ou quer informar.
  creditLimit: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? parseBRLToCents(v) : null)),
  // Limite do cheque especial. Só faz sentido em conta corrente.
  overdraftLimit: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? parseBRLToCents(v) : null)),
  bankIspb: z.string().trim().max(20).optional().nullable(),
  bankName: z.string().trim().max(120).optional().nullable(),
  logoUrl: z
    .string()
    .trim()
    .max(300)
    // Só https e só o CDN de logos. Aceitar URL arbitrária deixaria a tela de
    // cadastro virar vetor para carregar imagem de qualquer servidor.
    .refine((v) => v === "" || v.startsWith("https://cdn.jsdelivr.net/"), "Logo inválido.")
    .optional()
    .nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."),
  // Saldo pode ser negativo: cartão de crédito e cheque especial começam no
  // vermelho, e forçar zero obrigaria a mentir no cadastro.
  opening: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return 0;
      const negative = v.trim().startsWith("-");
      const cents = parseBRLToCents(v.replace(/^-/, ""));
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Valor inválido." });
        return z.NEVER;
      }
      return negative ? -cents : cents;
    }),
  })
  // Sem fechamento e vencimento, o app não sabe em qual fatura a parcela cai —
  // e cairia no mês da compra, adiantando o gasto em até dois meses.
  .refine((v) => v.kind !== "CARTAO" || v.closingDay !== undefined, {
    message: "Informe o dia de fechamento da fatura.",
    path: ["closingDay"],
  })
  .refine((v) => v.kind !== "CARTAO" || v.dueDay !== undefined, {
    message: "Informe o dia de vencimento da fatura.",
    path: ["dueDay"],
  });

export const incomeSourceSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(40),
  kind: z.enum(["CLT", "PJ", "OUTRO"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."),
});

export const goalSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(60),
  target: moneyField("meta"),
  saved: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? (parseBRLToCents(v) ?? 0) : 0)),
  deadline: isoDate.optional().nullable(),
});

export const scenarioSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(60),
  initial: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? (parseBRLToCents(v) ?? 0) : 0)),
  monthly: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? (parseBRLToCents(v) ?? 0) : 0)),
  months: z.coerce.number().int().min(1).max(720),
  rateSource: z.enum(["CDI", "SELIC", "POUPANCA", "CUSTOM"]),
  ratePercentOfIndex: z.coerce.number().min(1).max(300).default(100),
  customAnnualRate: z.coerce.number().min(0).max(100).default(12),
  showReal: z.coerce.boolean().default(true),
});

/** Formato único de retorno das actions — o cliente sempre sabe o que esperar. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Converte erro do zod no formato acima, sem vazar detalhe interno. */
export function zodToResult(error: z.ZodError): ActionResult {
  const flat = z.flattenError(error);
  const first =
    Object.values(flat.fieldErrors).flat()[0] ??
    flat.formErrors[0] ??
    "Dados inválidos.";
  return {
    ok: false,
    error: first as string,
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

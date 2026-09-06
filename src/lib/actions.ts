"use server";

import { revalidatePath } from "next/cache";

import { learnFromCorrection, parseBulk, reinforce } from "./categorize";
import { today } from "./dates";
import * as repo from "./repo";
import {
  accountSchema,
  billSchema,
  categorySchema,
  goalSchema,
  incomeSourceSchema,
  payBillSchema,
  scenarioSchema,
  transactionSchema,
  zodToResult,
  type ActionResult,
} from "./validation";
import type { ParsedEntry } from "./categorize";

/**
 * Server Actions — a única porta de escrita do app.
 *
 * Padrão de todas: validar -> gravar -> revalidar rota -> devolver ActionResult.
 * Nenhuma lança exceção para o cliente: erro previsto vira `{ ok: false }` com
 * mensagem legível, porque exceção em Server Action chega no browser como
 * "an error occurred", que não ajuda ninguém.
 */

/** As telas que dependem de lançamento. Revalidadas juntas após cada escrita. */
function revalidateFinance(): void {
  revalidatePath("/");
  revalidatePath("/relatorios");
  revalidatePath("/contas");
  revalidatePath("/economia");
  revalidatePath("/investimentos");
  revalidatePath("/carteiras");
}

// -------------------------------------------------------------- lançamentos

export async function createTransactionAction(
  formData: FormData,
): Promise<ActionResult> {
  const nature = formData.get("nature");

  const parsed = transactionSchema.safeParse({
    type: formData.get("type"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    nature: nature || "VISTA",
    // Só faz sentido em PARCELADO; nos outros vai undefined para não reprovar
    // no min(1) com uma mensagem que não diz respeito ao que o usuário fez.
    installments: nature === "PARCELADO" ? formData.get("installments") : undefined,
    amountMode: formData.get("amountMode") || "TOTAL",
    accountId: formData.get("accountId") || null,
    incomeSourceId: formData.get("incomeSourceId") || null,
    method: formData.get("method") || null,
    notes: formData.get("notes") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    const { amount, amountMode, installments } = parsed.data;

    // O repositório sempre recebe o TOTAL da compra. Quando o usuário digitou
    // o valor da parcela, a multiplicação acontece aqui — um único lugar sabe
    // dessa diferença, e o resto do sistema só lida com total.
    const totalCents =
      parsed.data.nature === "PARCELADO" && amountMode === "PARCELA"
        ? amount * (installments ?? 1)
        : amount;

    repo.createTransaction({
      type: parsed.data.type,
      amountCents: totalCents,
      date: parsed.data.date,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId,
      nature: parsed.data.nature,
      installments,
      accountId: parsed.data.accountId ?? null,
      // Fonte de renda só se aplica a entrada. Deixar num gasto criaria dado
      // sem sentido ("este almoço veio do salário CLT").
      incomeSourceId:
        parsed.data.type === "INCOME" ? (parsed.data.incomeSourceId ?? null) : null,
      method: parsed.data.method ?? null,
      notes: parsed.data.notes ?? null,
    });

    // Custo fixo marcado como "também cadastrar em Contas a pagar": cria a
    // conta recorrente junto. Falhar aqui NÃO derruba o lançamento — o gasto
    // já foi gravado, e perder o registro por causa do extra seria pior.
    if (parsed.data.nature === "FIXO" && formData.get("alsoBill") === "on") {
      const dia = Number(formData.get("billDueDay"));
      if (Number.isInteger(dia) && dia >= 1 && dia <= 31) {
        try {
          repo.createBill({
            name: parsed.data.description,
            recurrence: "MONTHLY",
            amountCents: totalCents,
            dueDay: dia,
            dueDate: null,
            categoryId: parsed.data.categoryId,
            variable: false,
            active: true,
            barcode: null,
            notes: null,
          });
        } catch (e) {
          console.error("[actions] falha ao criar conta a pagar junto:", e);
        }
      }
    }

    // O usuário escolheu a categoria à mão: isso é o sinal mais confiável que
    // existe sobre o que essa descrição significa. Vira regra aprendida.
    learnFromCorrection(parsed.data.description, parsed.data.categoryId);

    revalidateFinance();
    return { ok: true, message: "Lançamento salvo." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteTransaction(id);
    revalidateFinance();
    return { ok: true, message: "Lançamento excluído." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------------- lançamento em lote

/**
 * Fase 1 do lançamento rápido: interpreta o texto e devolve o que ENTENDEU,
 * sem gravar nada.
 *
 * A confirmação existe porque categorizar sozinho e salvar direto é rápido até
 * errar — e um gasto na categoria errada contamina silenciosamente todo o
 * diagnóstico do mês. Você vê o palpite, corrige o que estiver torto, e só aí grava.
 */
export async function previewBulkAction(
  text: string,
): Promise<{ ok: true; entries: ParsedEntry[] } | { ok: false; error: string }> {
  if (!text.trim()) return { ok: false, error: "Escreva ao menos um lançamento." };

  try {
    const categories = repo.listCategories();
    const entries = parseBulk(text, categories);

    if (entries.length === 0) {
      return {
        ok: false,
        error:
          "Não consegui identificar nenhum lançamento. Use o formato 'descrição valor', um por linha.",
      };
    }
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/** Fase 2: grava os lançamentos já revisados. */
export async function commitBulkAction(
  entries: Array<{
    description: string;
    amountCents: number;
    type: "INCOME" | "EXPENSE";
    categoryId: string;
    date: string;
    nature: "FIXO" | "VISTA" | "PARCELADO";
    /** Só em PARCELADO. `amountCents` é o TOTAL da compra. */
    installments: number | null;
    accountId: string | null;
    incomeSourceId: string | null;
    method: "PIX" | "DEBITO" | "CREDITO" | "DINHEIRO" | "BOLETO" | "TRANSFERENCIA" | null;
    matchedKeyword: string | null;
    /** true quando o usuário trocou a categoria sugerida. */
    corrected: boolean;
  }>,
): Promise<ActionResult> {
  if (entries.length === 0) return { ok: false, error: "Nada para salvar." };

  try {
    for (const e of entries) {
      if (e.amountCents <= 0 || !e.categoryId || !e.description.trim()) {
        return { ok: false, error: `Lançamento incompleto: "${e.description}".` };
      }
      if (e.nature === "PARCELADO" && (e.installments ?? 0) < 2) {
        return {
          ok: false,
          error: `"${e.description}" está marcado como parcelado sem número de parcelas.`,
        };
      }
    }

    for (const e of entries) {
      repo.createTransaction({
        type: e.type,
        amountCents: e.amountCents,
        date: e.date,
        description: e.description,
        categoryId: e.categoryId,
        nature: e.nature,
        installments: e.installments ?? undefined,
        accountId: e.accountId,
        incomeSourceId: e.type === "INCOME" ? e.incomeSourceId : null,
        method: e.method,
        notes: null,
      });

      // Aprendizado assimétrico, de propósito: correção cria regra nova
      // (sinal forte), acerto só reforça a regra existente (sinal fraco).
      // Criar regra a cada acerto encheria a base de sinônimo redundante.
      if (e.corrected) {
        learnFromCorrection(e.description, e.categoryId);
      } else if (e.matchedKeyword) {
        reinforce(e.matchedKeyword);
      }
    }

    revalidateFinance();
    return {
      ok: true,
      message: `${entries.length} ${entries.length === 1 ? "lançamento salvo" : "lançamentos salvos"}.`,
    };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// --------------------------------------------------------------- categorias

export async function createCategoryAction(formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
    icon: formData.get("icon") || "circle",
    budget: formData.get("budget") || undefined,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createCategory({
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
      icon: parsed.data.icon,
      budgetCents: parsed.data.budget,
    });
    revalidateFinance();
    revalidatePath("/categorias");
    return { ok: true, message: "Categoria criada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function updateBudgetAction(
  id: string,
  budget: string,
): Promise<ActionResult> {
  const parsed = categorySchema
    .pick({ budget: true })
    .safeParse({ budget: budget || undefined });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.updateCategoryBudget(id, parsed.data.budget);
    revalidateFinance();
    revalidatePath("/categorias");
    return { ok: true, message: "Orçamento atualizado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------------------ contas a pagar

export async function createBillAction(formData: FormData): Promise<ActionResult> {
  const recurrence = formData.get("recurrence");

  const parsed = billSchema.safeParse({
    name: formData.get("name"),
    recurrence,
    amount: formData.get("amount"),
    // Campo do outro tipo de recorrência vai como undefined: mandar string
    // vazia faria o coerce virar 0 e reprovar no min(1) com erro confuso.
    dueDay: recurrence === "MONTHLY" ? formData.get("dueDay") : undefined,
    dueDate: recurrence === "ONCE" ? formData.get("dueDate") : undefined,
    categoryId: formData.get("categoryId"),
    variable: formData.get("variable") === "on",
    barcode: formData.get("barcode") || null,
    notes: formData.get("notes") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createBill({
      name: parsed.data.name,
      recurrence: parsed.data.recurrence,
      amountCents: parsed.data.amount,
      dueDay: parsed.data.dueDay ?? null,
      dueDate: parsed.data.dueDate ?? null,
      categoryId: parsed.data.categoryId,
      variable: parsed.data.variable,
      active: true,
      barcode: parsed.data.barcode ?? null,
      notes: parsed.data.notes ?? null,
    });
    revalidateFinance();
    return { ok: true, message: "Conta cadastrada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function payBillAction(formData: FormData): Promise<ActionResult> {
  const parsed = payBillSchema.safeParse({
    billId: formData.get("billId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    accountId: formData.get("accountId") || null,
    notes: formData.get("notes") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.payBill({
      billId: parsed.data.billId,
      amountCents: parsed.data.amount,
      date: parsed.data.date,
      accountId: parsed.data.accountId ?? null,
      notes: parsed.data.notes ?? null,
    });
    revalidateFinance();
    return { ok: true, message: "Conta quitada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/**
 * Quitação em um clique, pelo valor previsto e na data de hoje.
 *
 * Existe separado do formulário porque a maioria das contas tem valor fixo:
 * abrir formulário para confirmar um número que já está na tela é atrito puro.
 * Conta variável continua indo pelo formulário, onde o valor real é informado.
 */
export async function payBillQuickAction(
  billId: string,
  accountId?: string | null,
): Promise<ActionResult> {
  try {
    const bill = repo.getBill(billId);
    if (!bill) return { ok: false, error: "Conta não encontrada." };

    repo.payBill({
      billId,
      amountCents: bill.amountCents,
      date: today(),
      accountId: accountId ?? null,
      notes: null,
    });
    revalidateFinance();
    return { ok: true, message: `${bill.name} quitada.` };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/**
 * Paga a fatura do cartão como transferência entre contas próprias.
 *
 * Não usa payBill: aquilo cria uma DESPESA, e as compras do cartão já foram
 * contadas como gasto no mês do vencimento. Registrar o pagamento como despesa
 * nova dobraria o total do mês.
 */
export async function payCardInvoiceAction(
  cardId: string,
  fromAccountId: string,
  amountCents: number,
  date: string,
): Promise<ActionResult> {
  if (!fromAccountId) {
    return { ok: false, error: "Escolha de qual conta sai o pagamento da fatura." };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Valor da fatura inválido." };
  }

  try {
    repo.payCardInvoice({ cardId, fromAccountId, amountCents, date });
    revalidateFinance();
    return { ok: true, message: "Fatura quitada. O valor saiu da conta escolhida." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/**
 * Quita um lançamento que estava agendado (data futura).
 * Atualiza a linha existente — criar outra contaria o gasto duas vezes.
 */
export async function payScheduledAction(
  transactionId: string,
  accountId: string,
  amountCents: number,
  date: string,
): Promise<ActionResult> {
  if (!accountId) {
    return { ok: false, error: "Escolha de qual conta esse pagamento sai." };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Valor inválido." };
  }

  try {
    repo.payScheduledTransaction({
      transactionId,
      accountId,
      amountCents,
      date,
      method: null,
    });
    revalidateFinance();
    return { ok: true, message: "Pagamento registrado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ---------------------------------------------------------------- carteiras

export async function createAccountAction(formData: FormData): Promise<ActionResult> {
  const kind = formData.get("kind");

  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    kind,
    color: formData.get("color"),
    opening: formData.get("opening") || undefined,
    closingDay: kind === "CARTAO" ? formData.get("closingDay") : undefined,
    dueDay: kind === "CARTAO" ? formData.get("dueDay") : undefined,
    last4: kind === "CARTAO" ? formData.get("last4") || undefined : undefined,
    creditLimit: kind === "CARTAO" ? formData.get("creditLimit") || undefined : undefined,
    overdraftLimit:
      kind === "CORRENTE" ? formData.get("overdraftLimit") || undefined : undefined,
    bankIspb: formData.get("bankIspb") || null,
    bankName: formData.get("bankName") || null,
    logoUrl: formData.get("logoUrl") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createAccount({
      name: parsed.data.name,
      kind: parsed.data.kind,
      openingCents: parsed.data.opening,
      closingDay: parsed.data.closingDay ?? null,
      dueDay: parsed.data.dueDay ?? null,
      last4: parsed.data.last4 ?? null,
      creditLimitCents: parsed.data.creditLimit ?? null,
      overdraftLimitCents: parsed.data.overdraftLimit ?? null,
      bankIspb: parsed.data.bankIspb ?? null,
      bankName: parsed.data.bankName ?? null,
      logoUrl: parsed.data.logoUrl ?? null,
      color: parsed.data.color,
    });
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Carteira criada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/**
 * Edita conta/cartão. Mesma validação do cadastro — o formulário é o mesmo,
 * só muda o destino.
 */
export async function updateAccountAction(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Registro não identificado." };

  const kind = formData.get("kind");

  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    kind,
    color: formData.get("color"),
    opening: formData.get("opening") || undefined,
    closingDay: kind === "CARTAO" ? formData.get("closingDay") : undefined,
    dueDay: kind === "CARTAO" ? formData.get("dueDay") : undefined,
    last4: kind === "CARTAO" ? formData.get("last4") || undefined : undefined,
    creditLimit: kind === "CARTAO" ? formData.get("creditLimit") || undefined : undefined,
    overdraftLimit:
      kind === "CORRENTE" ? formData.get("overdraftLimit") || undefined : undefined,
    bankIspb: formData.get("bankIspb") || null,
    bankName: formData.get("bankName") || null,
    logoUrl: formData.get("logoUrl") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.updateAccount(id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      openingCents: parsed.data.opening,
      closingDay: parsed.data.closingDay ?? null,
      dueDay: parsed.data.dueDay ?? null,
      last4: parsed.data.last4 ?? null,
      creditLimitCents: parsed.data.creditLimit ?? null,
      overdraftLimitCents: parsed.data.overdraftLimit ?? null,
      bankIspb: parsed.data.bankIspb ?? null,
      bankName: parsed.data.bankName ?? null,
      logoUrl: parsed.data.logoUrl ?? null,
      color: parsed.data.color,
    });
    revalidateFinance();
    revalidatePath("/configuracoes");
    return { ok: true, message: "Alterações salvas." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteAccount(id);
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Carteira excluída. Os lançamentos foram mantidos." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ----------------------------------------------------------- fontes de renda

export async function createIncomeSourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = incomeSourceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createIncomeSource({
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
    });
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Fonte de renda criada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteIncomeSourceAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteIncomeSource(id);
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Fonte excluída. Os lançamentos foram mantidos." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/** Exclui uma compra parcelada inteira, com todas as parcelas futuras. */
export async function deletePurchaseAction(purchaseId: string): Promise<ActionResult> {
  try {
    repo.deletePurchase(purchaseId);
    revalidateFinance();
    return { ok: true, message: "Compra e todas as parcelas excluídas." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function unpayBillAction(transactionId: string): Promise<ActionResult> {
  try {
    repo.unpayBill(transactionId);
    revalidateFinance();
    return { ok: true, message: "Pagamento desfeito." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function setBillActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    repo.setBillActive(id, active);
    revalidateFinance();
    return { ok: true, message: active ? "Conta reativada." : "Conta pausada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteBillAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteBill(id);
    revalidateFinance();
    return { ok: true, message: "Conta excluída." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// -------------------------------------------------------------------- metas

export async function createGoalAction(formData: FormData): Promise<ActionResult> {
  const parsed = goalSchema.safeParse({
    name: formData.get("name"),
    target: formData.get("target"),
    saved: formData.get("saved") || undefined,
    deadline: formData.get("deadline") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createGoal({
      name: parsed.data.name,
      targetCents: parsed.data.target,
      savedCents: parsed.data.saved,
      deadline: parsed.data.deadline ?? null,
    });
    revalidatePath("/economia");
    return { ok: true, message: "Meta criada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function addToGoalAction(
  id: string,
  amount: string,
): Promise<ActionResult> {
  const parsed = goalSchema.pick({ target: true }).safeParse({ target: amount });
  if (!parsed.success) return { ok: false, error: "Valor inválido." };

  try {
    repo.addToGoal(id, parsed.data.target);
    revalidatePath("/economia");
    return { ok: true, message: "Valor somado à meta." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteGoal(id);
    revalidatePath("/economia");
    return { ok: true, message: "Meta excluída." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ----------------------------------------------------------------- cenários

export async function createScenarioAction(formData: FormData): Promise<ActionResult> {
  const parsed = scenarioSchema.safeParse({
    name: formData.get("name"),
    initial: formData.get("initial") || undefined,
    monthly: formData.get("monthly") || undefined,
    months: formData.get("months"),
    rateSource: formData.get("rateSource"),
    ratePercentOfIndex: formData.get("ratePercentOfIndex") || 100,
    customAnnualRate: formData.get("customAnnualRate") || 12,
    showReal: formData.get("showReal") === "on",
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    repo.createScenario({
      name: parsed.data.name,
      initialCents: parsed.data.initial,
      monthlyCents: parsed.data.monthly,
      months: parsed.data.months,
      rateSource: parsed.data.rateSource,
      ratePercentOfIndex: parsed.data.ratePercentOfIndex,
      customAnnualRate: parsed.data.customAnnualRate,
      showReal: parsed.data.showReal,
    });
    revalidatePath("/investimentos");
    return { ok: true, message: "Cenário criado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteScenarioAction(id: string): Promise<ActionResult> {
  try {
    repo.deleteScenario(id);
    revalidatePath("/investimentos");
    return { ok: true, message: "Cenário excluído." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------- adaptadores p/ formulário

/**
 * `useActionState` chama a action como `(estadoAnterior, formData)`, enquanto
 * as actions acima recebem só o `formData` — assinatura mais simples para quem
 * chama direto (botão, código). Estes adaptadores ligam os dois formatos sem
 * duplicar regra de negócio.
 */
type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export const createTransactionForm: FormAction = async (_prev, formData) =>
  createTransactionAction(formData);

export const createCategoryForm: FormAction = async (_prev, formData) =>
  createCategoryAction(formData);

export const createBillForm: FormAction = async (_prev, formData) =>
  createBillAction(formData);

export const payBillForm: FormAction = async (_prev, formData) =>
  payBillAction(formData);

export const createGoalForm: FormAction = async (_prev, formData) =>
  createGoalAction(formData);

export const createScenarioForm: FormAction = async (_prev, formData) =>
  createScenarioAction(formData);

export const createAccountForm: FormAction = async (_prev, formData) =>
  createAccountAction(formData);

export const updateAccountForm: FormAction = async (_prev, formData) =>
  updateAccountAction(formData);

export const createIncomeSourceForm: FormAction = async (_prev, formData) =>
  createIncomeSourceAction(formData);

/**
 * Traduz erro do banco para linguagem de gente — SEM engolir o original.
 *
 * A versão anterior devolvia "Não foi possível salvar" para qualquer erro não
 * previsto, e o texto real só aparecia no console do servidor. Numa versão beta
 * isso é o pior dos dois mundos: quem usa não consegue relatar o que houve, e
 * quem desenvolve não consegue reproduzir. Agora o erro desconhecido chega
 * inteiro na tela, com prefixo indicando que é detalhe técnico.
 *
 * Os casos PREVISTOS continuam com mensagem amigável — ali a tradução ajuda,
 * porque "UNIQUE constraint failed: categories.name" não diz nada a ninguém.
 */
function mensagemDeErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (raw.includes("UNIQUE constraint failed: categories.name")) {
    return "Já existe uma categoria com esse nome.";
  }
  if (raw.includes("UNIQUE constraint failed: accounts.name")) {
    return "Já existe uma conta ou cartão com esse apelido. Use outro nome.";
  }
  if (raw.includes("UNIQUE constraint failed: income_sources.name")) {
    return "Já existe uma empresa com esse nome.";
  }
  if (raw.includes("FOREIGN KEY constraint failed")) {
    return "Registro relacionado inválido ou removido. Recarregue a página.";
  }
  if (raw.includes("CHECK constraint failed: accounts")) {
    return `Valor fora do permitido no cadastro da conta. Detalhe: ${raw}`;
  }
  if (raw.includes("CHECK constraint failed")) {
    return `Algum valor está fora do permitido. Detalhe: ${raw}`;
  }
  if (raw.includes("NOT NULL constraint failed")) {
    return `Faltou preencher um campo obrigatório. Detalhe: ${raw}`;
  }

  console.error("[actions] erro não tratado:", e);
  // Beta: mostra o erro real em vez de escondê-lo. Quando o app estabilizar,
  // dá para voltar a uma mensagem genérica — mas aí os casos já estarão mapeados.
  return `Erro não tratado: ${raw}`;
}

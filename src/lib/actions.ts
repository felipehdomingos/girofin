"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { learnFromCorrection, parseBulk, reinforce } from "./categorize";
import { addMonthsToDate, today } from "./dates";
import * as repo from "./repo";
import { currentUserId } from "./auth-http";
import { updateUserProfile } from "./auth-db";
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

/**
 * Recusa padrao das actions sem sessao.
 *
 * O layout de (app) redireciona para /login, mas isso nao protege nada aqui: a
 * doc do Next e explicita em que layout nao controla se o resto da rota roda, e
 * Server Action tem rota propria com ID estavel que qualquer cliente chama por
 * POST sem passar por layout nenhum.
 */
const DENIED = { ok: false as const, error: "Faça login para continuar." };

/** Teto e formato das linhas vindas do parser de fatura (client-side). */
const importInvoiceLinesSchema = z
  .array(
    z.object({
      description: z.string().trim().min(1).max(200),
      amountCents: z.number().int().min(-100_000_000).max(100_000_000),
      purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      categoryId: z.string().min(1).max(64),
      installmentNo: z.number().int().min(1).max(99).nullable(),
      installmentTotal: z.number().int().min(1).max(99).nullable(),
    }),
  )
  .min(1)
  .max(500);

/**
 * Teto e formato das linhas revisadas do lançamento rápido.
 *
 * Server Action é endpoint HTTP: o array chega direto do cliente, e não do
 * preview. Sem schema, `installments` grande passava até `await repo.createTransaction`,
 * que faz `splitCents(total, parts)` -> `Array.from({ length: parts })` e
 * derrubava o processo por memória com um único POST. Os limites são os mesmos
 * de `transactionSchema` (72 parcelas) e de `importInvoiceLinesSchema` (500
 * linhas), porque é o mesmo tipo de dado entrando pela mesma tabela.
 */
const bulkEntriesSchema = z
  .array(
    z.object({
      description: z.string().trim().min(1).max(200),
      amountCents: z.number().int().min(1).max(100_000_000),
      type: z.enum(["INCOME", "EXPENSE"]),
      categoryId: z.string().min(1).max(64),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      nature: z.enum(["FIXO", "VISTA", "PARCELADO"]),
      installments: z.number().int().min(1).max(72).nullable(),
      accountId: z.string().max(64).nullable(),
      incomeSourceId: z.string().max(64).nullable(),
      method: z
        .enum(["PIX", "DEBITO", "CREDITO", "DINHEIRO", "BOLETO", "TRANSFERENCIA"])
        .nullable(),
      matchedKeyword: z.string().max(120).nullable(),
      corrected: z.boolean(),
    }),
  )
  .min(1)
  .max(500);

/** Teto do texto do lançamento rápido. Ver previewBulkAction. */
const MAX_BULK_TEXT_CHARS = 20_000;
const MAX_BULK_LINES = 500;

/** As telas que dependem de lançamento. Revalidadas juntas após cada escrita. */
function revalidateFinance(): void {
  revalidatePath("/");
  revalidatePath("/relatorios");
  revalidatePath("/contas");
  revalidatePath("/economia");
  revalidatePath("/investimentos");
  revalidatePath("/carteiras");
}

/**
 * Valida o avatar como data URL de imagem de verdade.
 *
 * Antes a checagem era só o prefixo e o comprimento: qualquer coisa depois de
 * "data:image/png;base64," era gravada como se fosse imagem. Não dá XSS (o
 * `<img>` honra o MIME declarado e não executa nada), mas a coluna virava
 * armazenamento de conteúdo arbitrário — 2 MB por usuário de qualquer bytes,
 * servidos de volta pela aplicação para o navegador de quem abre o perfil.
 *
 * Duas checagens além do prefixo: o payload precisa ser base64 bem formado, e
 * os primeiros bytes decodificados precisam bater com a assinatura do formato
 * declarado no MIME. Só o cabeçalho é decodificado; validar 2 MB de base64 a
 * cada gravação seria trabalho desnecessário.
 */
function avatarValido(dataUrl: string): boolean {
  if (dataUrl.length > 2_800_000) return false;

  const cabecalho = /^data:image\/(jpeg|png|webp);base64,/i.exec(dataUrl);
  if (!cabecalho) return false;

  const tipo = cabecalho[1].toLowerCase();
  const payload = dataUrl.slice(cabecalho[0].length);
  // Base64 canônico: alfabeto padrão, sem quebra de linha, múltiplo de 4.
  if (payload.length < 4 || payload.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;

  const inicio = Buffer.from(payload.slice(0, 32), "base64");
  if (inicio.length < 12) return false;

  if (tipo === "jpeg") return inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff;
  if (tipo === "png") {
    return inicio.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  // WebP: "RIFF" + 4 bytes de tamanho + "WEBP".
  return inicio.subarray(0, 4).toString("ascii") === "RIFF" &&
    inicio.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Faça login para atualizar seu perfil." };

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const birthDate = String(formData.get("birthDate") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim().toUpperCase();
  const avatarDataUrl = String(formData.get("avatarDataUrl") ?? "").trim();
  // CEP guardado so com digito: mascara e coisa de tela, nao de banco.
  const cep = String(formData.get("cep") ?? "").replace(/\D/g, "");
  const street = String(formData.get("street") ?? "").trim();
  const streetNumber = String(formData.get("streetNumber") ?? "").trim();
  const complement = String(formData.get("complement") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Informe um nome entre 2 e 80 caracteres." };
  }
  if (phone.length > 30 || city.length > 80 || !/^[A-Z]{0,2}$/.test(state)) {
    return { ok: false, error: "Confira telefone, cidade e UF antes de salvar." };
  }
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, error: "Informe uma data de nascimento válida." };
  }
  if (cep && cep.length !== 8) {
    return { ok: false, error: "O CEP deve ter 8 dígitos." };
  }
  if (street.length > 120 || district.length > 80 || streetNumber.length > 20 || complement.length > 60) {
    return { ok: false, error: "Confira o endereço antes de salvar." };
  }
  if (avatarDataUrl && !avatarValido(avatarDataUrl)) {
    return { ok: false, error: "A foto deve ser JPG, PNG ou WebP e ter no máximo 2 MB." };
  }

  try {
    await updateUserProfile({
      userId,
      name,
      phone: phone || null,
      birthDate: birthDate || null,
      cep: cep || null,
      street: street || null,
      streetNumber: streetNumber || null,
      complement: complement || null,
      district: district || null,
      city: city || null,
      state: state || null,
      avatarDataUrl: avatarDataUrl || null,
    });
    revalidatePath("/configuracoes");
    revalidatePath("/");
    return { ok: true, message: "Perfil atualizado com sucesso." };
  } catch (error) {
    console.error("[profile/update]", error);
    return { ok: false, error: "Não foi possível salvar o perfil agora. Tente novamente." };
  }
}

// -------------------------------------------------------------- lançamentos

export async function createTransactionAction(
  formData: FormData,
): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

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

    await repo.createTransaction({
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
          await repo.createBill({
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

export async function updateTransactionAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Lancamento nao informado." };

  const parsed = transactionSchema.safeParse({
    type: formData.get("type"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    // A estrutura da compra nao se edita por aqui: a parcela e uma linha de um
    // conjunto, e mexer nisso pelo formulario de uma delas deixaria as outras
    // orfas de uma compra que mudou de forma.
    nature: "VISTA",
    accountId: formData.get("accountId") || null,
    incomeSourceId: formData.get("incomeSourceId") || null,
    method: formData.get("method") || undefined,
  });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateTransaction(id, {
      type: parsed.data.type,
      amountCents: parsed.data.amount,
      date: parsed.data.date,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId,
      accountId: parsed.data.accountId ?? null,
      incomeSourceId: parsed.data.incomeSourceId ?? null,
      method: parsed.data.method ?? null,
    });
    revalidateFinance();
    return { ok: true, message: "Lancamento atualizado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteTransaction(id);
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  // Server Action recebe o que o cliente serializar: o tipo declarado não é
  // garantia nenhuma em runtime, e `.trim()` num não-string estouraria aqui.
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Escreva ao menos um lançamento." };
  }

  /*
   * Teto de tamanho antes de tocar no parser.
   *
   * `text` vem direto do cliente (Server Action é rota HTTP) e cada linha passa
   * por regex com `.*?` preguiçoso seguido de `[\d.,]+` guloso ancorado no fim —
   * padrão de backtracking quadrático. Sem teto, um texto grande vira minutos de
   * CPU num processo single-threaded, que é DoS com uma requisição.
   */
  if (text.length > MAX_BULK_TEXT_CHARS) {
    return { ok: false, error: "Texto longo demais. Divida em blocos menores." };
  }
  if (text.split("\n").length > MAX_BULK_LINES) {
    return { ok: false, error: `Envie no máximo ${MAX_BULK_LINES} linhas por vez.` };
  }

  try {
    const categories = await repo.listCategories();
    const entries = await parseBulk(text, categories);

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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, error: "Nada para salvar." };
  }

  /*
   * Schema na fronteira: o array chega do cliente, não do preview. Sem ele,
   * `installments` sem teto chegava a `await repo.createTransaction`, que aloca um
   * elemento por parcela em `splitCents` — memória do processo inteiro por um
   * POST só. Os campos e limites espelham `importInvoiceLinesSchema`, que grava
   * o mesmo tipo de dado.
   */
  const parsed = bulkEntriesSchema.safeParse(entries);
  if (!parsed.success) {
    return { ok: false, error: "Lançamentos inválidos ou em quantidade acima do permitido." };
  }

  try {
    for (const e of parsed.data) {
      if (e.nature === "PARCELADO" && (e.installments ?? 0) < 2) {
        return {
          ok: false,
          error: `"${e.description}" está marcado como parcelado sem número de parcelas.`,
        };
      }
    }

    for (const e of parsed.data) {
      await repo.createTransaction({
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
      message: `${parsed.data.length} ${parsed.data.length === 1 ? "lançamento salvo" : "lançamentos salvos"}.`,
    };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// --------------------------------------------------------------- categorias

export async function createCategoryAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
    icon: formData.get("icon") || "circle",
    budget: formData.get("budget") || undefined,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.createCategory({
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

export async function updateCategoryAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Categoria nao informada." };

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
    icon: formData.get("icon") || "circle",
    budget: formData.get("budget") || undefined,
  });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateCategory(id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
      budgetCents: parsed.data.budget,
    });
    revalidateFinance();
    revalidatePath("/categorias");
    return { ok: true, message: "Categoria atualizada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    const resultado = await repo.deleteCategory(id);
    revalidateFinance();
    revalidatePath("/categorias");
    return {
      ok: true,
      message:
        resultado === "archived"
          ? "Categoria arquivada. Ela tinha lancamentos, entao saiu das listas mas o historico foi preservado."
          : "Categoria excluida.",
    };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function updateBudgetAction(
  id: string,
  budget: string,
): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = categorySchema
    .pick({ budget: true })
    .safeParse({ budget: budget || undefined });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateCategoryBudget(id, parsed.data.budget);
    revalidateFinance();
    revalidatePath("/categorias");
    return { ok: true, message: "Orçamento atualizado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------------------ contas a pagar

export async function createBillAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

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
    await repo.createBill({
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

export async function updateBillAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Conta nao informada." };
  const recurrence = formData.get("recurrence");

  const parsed = billSchema.safeParse({
    name: formData.get("name"),
    recurrence,
    amount: formData.get("amount"),
    dueDay: recurrence === "MONTHLY" ? formData.get("dueDay") : undefined,
    dueDate: recurrence === "ONCE" ? formData.get("dueDate") : undefined,
    categoryId: formData.get("categoryId"),
    variable: formData.get("variable") === "on",
    barcode: formData.get("barcode") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateBill(id, {
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
    return { ok: true, message: "Conta atualizada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function payBillAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = payBillSchema.safeParse({
    billId: formData.get("billId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    accountId: formData.get("accountId") || null,
    notes: formData.get("notes") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.payBill({
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    const bill = await repo.getBill(billId);
    if (!bill) return { ok: false, error: "Conta não encontrada." };

    await repo.payBill({
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  if (!fromAccountId) {
    return { ok: false, error: "Escolha de qual conta sai o pagamento da fatura." };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Valor da fatura inválido." };
  }

  try {
    await repo.payCardInvoice({ cardId, fromAccountId, amountCents, date });
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  if (!accountId) {
    return { ok: false, error: "Escolha de qual conta esse pagamento sai." };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Valor inválido." };
  }

  try {
    await repo.payScheduledTransaction({
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

/**
 * Grava as compras lidas de uma fatura de cartão.
 *
 * Recebe as linhas JÁ REVISADAS pelo usuário — o PDF é lido no navegador e
 * nunca chega aqui, nem a senha dele.
 *
 * Duas regras que decidem em qual mês cada linha cai:
 *
 * 1. Compra à vista e a PARCELA DESTE MÊS entram na fatura corrente, via a
 *    regra de ciclo do cartão (compra depois do fechamento vai para a fatura
 *    seguinte) — a mesma usada no lançamento manual.
 * 2. Parcela "3/10" significa que 3 já foram cobradas e 7 ainda vêm. Só as que
 *    FALTAM são criadas: as passadas já estão nas faturas anteriores, e
 *    recriá-las contaria o mesmo dinheiro duas vezes.
 */
export async function importInvoiceAction(
  cardId: string,
  linhas: Array<{
    description: string;
    amountCents: number;
    purchaseDate: string;
    categoryId: string;
    installmentNo: number | null;
    installmentTotal: number | null;
  }>,
): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  if (linhas.length === 0) return { ok: false, error: "Nenhuma compra selecionada." };

  /*
   * Diferente das rotas de API, uma Server Action recebe o argumento cru do
   * cliente. Sem schema nem teto, um POST com milhoes de linhas gravava uma
   * transacao por item ate encher o disco.
   */
  const parsed = importInvoiceLinesSchema.safeParse(linhas);
  if (!parsed.success) {
    return { ok: false, error: "Lista de compras invalida ou grande demais (limite de 500 itens)." };
  }
  linhas = parsed.data;

  try {
    const card = await repo.getAccount(cardId);
    if (!card || card.kind !== "CARTAO") {
      return { ok: false, error: "Cartão não encontrado." };
    }

    let criados = 0;
    let parcelasFuturas = 0;
    let estornos = 0;

    for (const l of linhas) {
      if (l.amountCents === 0 || !l.description.trim() || !l.categoryId) continue;

      /*
       * Estorno: a loja devolveu o dinheiro. Entra como ENTRADA no cartão, que
       * é literalmente o que acontece — o valor volta para o limite e abate a
       * fatura. Lançar como despesa negativa não daria certo: os totais do mês
       * somam despesas, e um valor negativo no meio deles some do relatório em
       * vez de aparecer como devolução.
       */
      if (l.amountCents < 0) {
        await repo.createTransaction({
          type: "INCOME",
          amountCents: Math.abs(l.amountCents),
          date: l.purchaseDate,
          description: l.description,
          categoryId: l.categoryId,
          nature: "VISTA",
          accountId: cardId,
          incomeSourceId: null,
          method: "CREDITO",
          notes: null,
        });
        estornos++;
        continue;
      }

      const restantes =
        l.installmentNo && l.installmentTotal
          ? Math.max(l.installmentTotal - l.installmentNo, 0)
          : 0;

      if (restantes === 0) {
        // À vista, ou última parcela: uma linha só.
        await repo.createTransaction({
          type: "EXPENSE",
          amountCents: l.amountCents,
          date: l.purchaseDate,
          description: l.installmentTotal
            ? `${l.description} (${l.installmentNo}/${l.installmentTotal})`
            : l.description,
          categoryId: l.categoryId,
          nature: l.installmentTotal ? "PARCELADO" : "VISTA",
          accountId: cardId,
          incomeSourceId: null,
          method: "CREDITO",
          notes: null,
        });
        criados++;
      } else {
        /*
         * Parcelada com parcelas a vencer. createTransaction divide um TOTAL,
         * mas aqui já se conhece o valor exato de cada parcela — multiplicar
         * para "recompor" o total e deixar dividir de novo introduziria erro de
         * centavo. Por isso cada parcela restante é criada individualmente.
         */
        for (let k = 0; k <= restantes; k++) {
          await repo.createTransaction({
            type: "EXPENSE",
            amountCents: l.amountCents,
            date: addMonthsToDate(l.purchaseDate, k),
            description: `${l.description} (${(l.installmentNo ?? 1) + k}/${l.installmentTotal})`,
            categoryId: l.categoryId,
            nature: "PARCELADO",
            accountId: cardId,
            incomeSourceId: null,
            method: "CREDITO",
            notes: null,
          });
        }
        criados++;
        parcelasFuturas += restantes;
      }

      learnFromCorrection(l.description, l.categoryId);
    }

    revalidateFinance();
    return {
      ok: true,
      message:
        `${criados} ${criados === 1 ? "compra importada" : "compras importadas"}` +
        (parcelasFuturas > 0
          ? ` · ${parcelasFuturas} parcela${parcelasFuturas === 1 ? "" : "s"} agendada${parcelasFuturas === 1 ? "" : "s"} para os próximos meses`
          : "") +
        (estornos > 0
          ? ` · ${estornos} estorno${estornos === 1 ? "" : "s"} abatido${estornos === 1 ? "" : "s"} da fatura`
          : ""),
    };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ---------------------------------------------------------------- carteiras

export async function createAccountAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

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
    await repo.createAccount({
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

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
    await repo.updateAccount(id, {
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteAccount(id);
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = incomeSourceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.createIncomeSource({
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

export async function updateIncomeSourceAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Fonte nao informada." };

  const parsed = incomeSourceSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
  });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateIncomeSource(id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
    });
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Fonte de renda atualizada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteIncomeSourceAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteIncomeSource(id);
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Fonte excluída. Os lançamentos foram mantidos." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/** Exclui uma compra parcelada inteira, com todas as parcelas futuras. */
export async function deletePurchaseAction(purchaseId: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deletePurchase(purchaseId);
    revalidateFinance();
    return { ok: true, message: "Compra e todas as parcelas excluídas." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function unpayBillAction(transactionId: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.unpayBill(transactionId);
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.setBillActive(id, active);
    revalidateFinance();
    return { ok: true, message: active ? "Conta reativada." : "Conta pausada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteBillAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteBill(id);
    revalidateFinance();
    return { ok: true, message: "Conta excluída." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// -------------------------------------------------------------------- metas

export async function createGoalAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = goalSchema.safeParse({
    name: formData.get("name"),
    target: formData.get("target"),
    saved: formData.get("saved") || undefined,
    deadline: formData.get("deadline") || null,
  });

  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.createGoal({
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
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const parsed = goalSchema.pick({ target: true }).safeParse({ target: amount });
  if (!parsed.success) return { ok: false, error: "Valor inválido." };

  try {
    await repo.addToGoal(id, parsed.data.target);
    revalidatePath("/economia");
    return { ok: true, message: "Valor somado à meta." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function updateGoalAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Meta nao informada." };

  const parsed = goalSchema.safeParse({
    name: formData.get("name"),
    target: formData.get("target"),
    saved: formData.get("saved") || undefined,
    deadline: formData.get("deadline") || null,
  });
  if (!parsed.success) return zodToResult(parsed.error);

  try {
    await repo.updateGoal(id, {
      name: parsed.data.name,
      targetCents: parsed.data.target,
      savedCents: parsed.data.saved,
      deadline: parsed.data.deadline ?? null,
    });
    revalidatePath("/economia");
    return { ok: true, message: "Meta atualizada." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteGoal(id);
    revalidatePath("/economia");
    return { ok: true, message: "Meta excluída." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ----------------------------------------------------------------- cenários

export async function createScenarioAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

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
    await repo.createScenario({
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

export async function updateScenarioAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Cenario nao informado." };

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
    await repo.updateScenario(id, {
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
    return { ok: true, message: "Cenario atualizado." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

export async function deleteScenarioAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteScenario(id);
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

export const updateCategoryForm: FormAction = async (_prev, formData) =>
  updateCategoryAction(formData);

export const updateTransactionForm: FormAction = async (_prev, formData) =>
  updateTransactionAction(formData);

export const updateBillForm: FormAction = async (_prev, formData) =>
  updateBillAction(formData);

export const updateIncomeSourceForm: FormAction = async (_prev, formData) =>
  updateIncomeSourceAction(formData);

export const updateGoalForm: FormAction = async (_prev, formData) =>
  updateGoalAction(formData);

export const updateScenarioForm: FormAction = async (_prev, formData) =>
  updateScenarioAction(formData);

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
 * Traduz erro do banco para linguagem de gente — sem devolver o original.
 *
 * A versão anterior colava a mensagem crua do SQLite na tela para facilitar o
 * relato de bug na beta. O preço era alto demais: ia junto o nome de tabela e
 * coluna, o caminho do arquivo do banco e o texto de `assertFinanceStorageMode`,
 * que descreve como o servidor guarda os dados. Isso é mapa do alvo entregue a
 * qualquer um que consiga provocar um erro.
 *
 * O relato continua possível pelo ID de correlação: o mesmo código aparece no
 * log do servidor, com a exceção inteira. Quem usa informa oito caracteres;
 * quem investiga acha o erro completo.
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
    return "Valor fora do permitido no cadastro da conta. Confira os campos e tente de novo.";
  }
  if (raw.includes("CHECK constraint failed")) {
    return "Algum valor está fora do permitido. Confira os campos e tente de novo.";
  }
  if (raw.includes("NOT NULL constraint failed")) {
    return "Faltou preencher um campo obrigatório.";
  }

  const id = randomUUID().slice(0, 8);
  console.error(`[actions] erro não tratado ${id}:`, e);
  return `Não foi possível concluir a operação. Informe o código ${id} ao suporte.`;
}


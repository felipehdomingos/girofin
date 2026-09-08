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
 * Server Actions â€” a Ãºnica porta de escrita do app.
 *
 * PadrÃ£o de todas: validar -> gravar -> revalidar rota -> devolver ActionResult.
 * Nenhuma lanÃ§a exceÃ§Ã£o para o cliente: erro previsto vira `{ ok: false }` com
 * mensagem legÃ­vel, porque exceÃ§Ã£o em Server Action chega no browser como
 * "an error occurred", que nÃ£o ajuda ninguÃ©m.
 */

/**
 * Recusa padrao das actions sem sessao.
 *
 * O layout de (app) redireciona para /login, mas isso nao protege nada aqui: a
 * doc do Next e explicita em que layout nao controla se o resto da rota roda, e
 * Server Action tem rota propria com ID estavel que qualquer cliente chama por
 * POST sem passar por layout nenhum.
 */
const DENIED = { ok: false as const, error: "FaÃ§a login para continuar." };

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
 * Teto e formato das linhas revisadas do lanÃ§amento rÃ¡pido.
 *
 * Server Action Ã© endpoint HTTP: o array chega direto do cliente, e nÃ£o do
 * preview. Sem schema, `installments` grande passava atÃ© `await repo.createTransaction`,
 * que faz `splitCents(total, parts)` -> `Array.from({ length: parts })` e
 * derrubava o processo por memÃ³ria com um Ãºnico POST. Os limites sÃ£o os mesmos
 * de `transactionSchema` (72 parcelas) e de `importInvoiceLinesSchema` (500
 * linhas), porque Ã© o mesmo tipo de dado entrando pela mesma tabela.
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

/** Teto do texto do lanÃ§amento rÃ¡pido. Ver previewBulkAction. */
const MAX_BULK_TEXT_CHARS = 20_000;
const MAX_BULK_LINES = 500;

/** As telas que dependem de lanÃ§amento. Revalidadas juntas apÃ³s cada escrita. */
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
 * Antes a checagem era sÃ³ o prefixo e o comprimento: qualquer coisa depois de
 * "data:image/png;base64," era gravada como se fosse imagem. NÃ£o dÃ¡ XSS (o
 * `<img>` honra o MIME declarado e nÃ£o executa nada), mas a coluna virava
 * armazenamento de conteÃºdo arbitrÃ¡rio â€” 2 MB por usuÃ¡rio de qualquer bytes,
 * servidos de volta pela aplicaÃ§Ã£o para o navegador de quem abre o perfil.
 *
 * Duas checagens alÃ©m do prefixo: o payload precisa ser base64 bem formado, e
 * os primeiros bytes decodificados precisam bater com a assinatura do formato
 * declarado no MIME. SÃ³ o cabeÃ§alho Ã© decodificado; validar 2 MB de base64 a
 * cada gravaÃ§Ã£o seria trabalho desnecessÃ¡rio.
 */
function avatarValido(dataUrl: string): boolean {
  if (dataUrl.length > 2_800_000) return false;

  const cabecalho = /^data:image\/(jpeg|png|webp);base64,/i.exec(dataUrl);
  if (!cabecalho) return false;

  const tipo = cabecalho[1].toLowerCase();
  const payload = dataUrl.slice(cabecalho[0].length);
  // Base64 canÃ´nico: alfabeto padrÃ£o, sem quebra de linha, mÃºltiplo de 4.
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
  if (!userId) return { ok: false, error: "FaÃ§a login para atualizar seu perfil." };

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const birthDate = String(formData.get("birthDate") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim().toUpperCase();
  const avatarDataUrl = String(formData.get("avatarDataUrl") ?? "").trim();

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Informe um nome entre 2 e 80 caracteres." };
  }
  if (phone.length > 30 || city.length > 80 || !/^[A-Z]{0,2}$/.test(state)) {
    return { ok: false, error: "Confira telefone, cidade e UF antes de salvar." };
  }
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, error: "Informe uma data de nascimento vÃ¡lida." };
  }
  if (avatarDataUrl && !avatarValido(avatarDataUrl)) {
    return { ok: false, error: "A foto deve ser JPG, PNG ou WebP e ter no mÃ¡ximo 2 MB." };
  }

  try {
    await updateUserProfile({
      userId,
      name,
      phone: phone || null,
      birthDate: birthDate || null,
      city: city || null,
      state: state || null,
      avatarDataUrl: avatarDataUrl || null,
    });
    revalidatePath("/configuracoes");
    revalidatePath("/");
    return { ok: true, message: "Perfil atualizado com sucesso." };
  } catch (error) {
    console.error("[profile/update]", error);
    return { ok: false, error: "NÃ£o foi possÃ­vel salvar o perfil agora. Tente novamente." };
  }
}

// -------------------------------------------------------------- lanÃ§amentos

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
    // SÃ³ faz sentido em PARCELADO; nos outros vai undefined para nÃ£o reprovar
    // no min(1) com uma mensagem que nÃ£o diz respeito ao que o usuÃ¡rio fez.
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

    // O repositÃ³rio sempre recebe o TOTAL da compra. Quando o usuÃ¡rio digitou
    // o valor da parcela, a multiplicaÃ§Ã£o acontece aqui â€” um Ãºnico lugar sabe
    // dessa diferenÃ§a, e o resto do sistema sÃ³ lida com total.
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
      // Fonte de renda sÃ³ se aplica a entrada. Deixar num gasto criaria dado
      // sem sentido ("este almoÃ§o veio do salÃ¡rio CLT").
      incomeSourceId:
        parsed.data.type === "INCOME" ? (parsed.data.incomeSourceId ?? null) : null,
      method: parsed.data.method ?? null,
      notes: parsed.data.notes ?? null,
    });

    // Custo fixo marcado como "tambÃ©m cadastrar em Contas a pagar": cria a
    // conta recorrente junto. Falhar aqui NÃƒO derruba o lanÃ§amento â€” o gasto
    // jÃ¡ foi gravado, e perder o registro por causa do extra seria pior.
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

    // O usuÃ¡rio escolheu a categoria Ã  mÃ£o: isso Ã© o sinal mais confiÃ¡vel que
    // existe sobre o que essa descriÃ§Ã£o significa. Vira regra aprendida.
    learnFromCorrection(parsed.data.description, parsed.data.categoryId);

    revalidateFinance();
    return { ok: true, message: "LanÃ§amento salvo." };
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
    return { ok: true, message: "LanÃ§amento excluÃ­do." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------------- lanÃ§amento em lote

/**
 * Fase 1 do lanÃ§amento rÃ¡pido: interpreta o texto e devolve o que ENTENDEU,
 * sem gravar nada.
 *
 * A confirmaÃ§Ã£o existe porque categorizar sozinho e salvar direto Ã© rÃ¡pido atÃ©
 * errar â€” e um gasto na categoria errada contamina silenciosamente todo o
 * diagnÃ³stico do mÃªs. VocÃª vÃª o palpite, corrige o que estiver torto, e sÃ³ aÃ­ grava.
 */
export async function previewBulkAction(
  text: string,
): Promise<{ ok: true; entries: ParsedEntry[] } | { ok: false; error: string }> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  // Server Action recebe o que o cliente serializar: o tipo declarado nÃ£o Ã©
  // garantia nenhuma em runtime, e `.trim()` num nÃ£o-string estouraria aqui.
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Escreva ao menos um lanÃ§amento." };
  }

  /*
   * Teto de tamanho antes de tocar no parser.
   *
   * `text` vem direto do cliente (Server Action Ã© rota HTTP) e cada linha passa
   * por regex com `.*?` preguiÃ§oso seguido de `[\d.,]+` guloso ancorado no fim â€”
   * padrÃ£o de backtracking quadrÃ¡tico. Sem teto, um texto grande vira minutos de
   * CPU num processo single-threaded, que Ã© DoS com uma requisiÃ§Ã£o.
   */
  if (text.length > MAX_BULK_TEXT_CHARS) {
    return { ok: false, error: "Texto longo demais. Divida em blocos menores." };
  }
  if (text.split("\n").length > MAX_BULK_LINES) {
    return { ok: false, error: `Envie no mÃ¡ximo ${MAX_BULK_LINES} linhas por vez.` };
  }

  try {
    const categories = await repo.listCategories();
    const entries = await parseBulk(text, categories);

    if (entries.length === 0) {
      return {
        ok: false,
        error:
          "NÃ£o consegui identificar nenhum lanÃ§amento. Use o formato 'descriÃ§Ã£o valor', um por linha.",
      };
    }
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

/** Fase 2: grava os lanÃ§amentos jÃ¡ revisados. */
export async function commitBulkAction(
  entries: Array<{
    description: string;
    amountCents: number;
    type: "INCOME" | "EXPENSE";
    categoryId: string;
    date: string;
    nature: "FIXO" | "VISTA" | "PARCELADO";
    /** SÃ³ em PARCELADO. `amountCents` Ã© o TOTAL da compra. */
    installments: number | null;
    accountId: string | null;
    incomeSourceId: string | null;
    method: "PIX" | "DEBITO" | "CREDITO" | "DINHEIRO" | "BOLETO" | "TRANSFERENCIA" | null;
    matchedKeyword: string | null;
    /** true quando o usuÃ¡rio trocou a categoria sugerida. */
    corrected: boolean;
  }>,
): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, error: "Nada para salvar." };
  }

  /*
   * Schema na fronteira: o array chega do cliente, nÃ£o do preview. Sem ele,
   * `installments` sem teto chegava a `await repo.createTransaction`, que aloca um
   * elemento por parcela em `splitCents` â€” memÃ³ria do processo inteiro por um
   * POST sÃ³. Os campos e limites espelham `importInvoiceLinesSchema`, que grava
   * o mesmo tipo de dado.
   */
  const parsed = bulkEntriesSchema.safeParse(entries);
  if (!parsed.success) {
    return { ok: false, error: "LanÃ§amentos invÃ¡lidos ou em quantidade acima do permitido." };
  }

  try {
    for (const e of parsed.data) {
      if (e.nature === "PARCELADO" && (e.installments ?? 0) < 2) {
        return {
          ok: false,
          error: `"${e.description}" estÃ¡ marcado como parcelado sem nÃºmero de parcelas.`,
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

      // Aprendizado assimÃ©trico, de propÃ³sito: correÃ§Ã£o cria regra nova
      // (sinal forte), acerto sÃ³ reforÃ§a a regra existente (sinal fraco).
      // Criar regra a cada acerto encheria a base de sinÃ´nimo redundante.
      if (e.corrected) {
        learnFromCorrection(e.description, e.categoryId);
      } else if (e.matchedKeyword) {
        reinforce(e.matchedKeyword);
      }
    }

    revalidateFinance();
    return {
      ok: true,
      message: `${parsed.data.length} ${parsed.data.length === 1 ? "lanÃ§amento salvo" : "lanÃ§amentos salvos"}.`,
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
    return { ok: true, message: "OrÃ§amento atualizado." };
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
    // Campo do outro tipo de recorrÃªncia vai como undefined: mandar string
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
 * QuitaÃ§Ã£o em um clique, pelo valor previsto e na data de hoje.
 *
 * Existe separado do formulÃ¡rio porque a maioria das contas tem valor fixo:
 * abrir formulÃ¡rio para confirmar um nÃºmero que jÃ¡ estÃ¡ na tela Ã© atrito puro.
 * Conta variÃ¡vel continua indo pelo formulÃ¡rio, onde o valor real Ã© informado.
 */
export async function payBillQuickAction(
  billId: string,
  accountId?: string | null,
): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    const bill = await repo.getBill(billId);
    if (!bill) return { ok: false, error: "Conta nÃ£o encontrada." };

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
 * Paga a fatura do cartÃ£o como transferÃªncia entre contas prÃ³prias.
 *
 * NÃ£o usa payBill: aquilo cria uma DESPESA, e as compras do cartÃ£o jÃ¡ foram
 * contadas como gasto no mÃªs do vencimento. Registrar o pagamento como despesa
 * nova dobraria o total do mÃªs.
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
    return { ok: false, error: "Valor da fatura invÃ¡lido." };
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
 * Quita um lanÃ§amento que estava agendado (data futura).
 * Atualiza a linha existente â€” criar outra contaria o gasto duas vezes.
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
    return { ok: false, error: "Valor invÃ¡lido." };
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
 * Grava as compras lidas de uma fatura de cartÃ£o.
 *
 * Recebe as linhas JÃ REVISADAS pelo usuÃ¡rio â€” o PDF Ã© lido no navegador e
 * nunca chega aqui, nem a senha dele.
 *
 * Duas regras que decidem em qual mÃªs cada linha cai:
 *
 * 1. Compra Ã  vista e a PARCELA DESTE MÃŠS entram na fatura corrente, via a
 *    regra de ciclo do cartÃ£o (compra depois do fechamento vai para a fatura
 *    seguinte) â€” a mesma usada no lanÃ§amento manual.
 * 2. Parcela "3/10" significa que 3 jÃ¡ foram cobradas e 7 ainda vÃªm. SÃ³ as que
 *    FALTAM sÃ£o criadas: as passadas jÃ¡ estÃ£o nas faturas anteriores, e
 *    recriÃ¡-las contaria o mesmo dinheiro duas vezes.
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
      return { ok: false, error: "CartÃ£o nÃ£o encontrado." };
    }

    let criados = 0;
    let parcelasFuturas = 0;
    let estornos = 0;

    for (const l of linhas) {
      if (l.amountCents === 0 || !l.description.trim() || !l.categoryId) continue;

      /*
       * Estorno: a loja devolveu o dinheiro. Entra como ENTRADA no cartÃ£o, que
       * Ã© literalmente o que acontece â€” o valor volta para o limite e abate a
       * fatura. LanÃ§ar como despesa negativa nÃ£o daria certo: os totais do mÃªs
       * somam despesas, e um valor negativo no meio deles some do relatÃ³rio em
       * vez de aparecer como devoluÃ§Ã£o.
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
        // Ã€ vista, ou Ãºltima parcela: uma linha sÃ³.
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
         * mas aqui jÃ¡ se conhece o valor exato de cada parcela â€” multiplicar
         * para "recompor" o total e deixar dividir de novo introduziria erro de
         * centavo. Por isso cada parcela restante Ã© criada individualmente.
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
          ? ` Â· ${parcelasFuturas} parcela${parcelasFuturas === 1 ? "" : "s"} agendada${parcelasFuturas === 1 ? "" : "s"} para os prÃ³ximos meses`
          : "") +
        (estornos > 0
          ? ` Â· ${estornos} estorno${estornos === 1 ? "" : "s"} abatido${estornos === 1 ? "" : "s"} da fatura`
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
 * Edita conta/cartÃ£o. Mesma validaÃ§Ã£o do cadastro â€” o formulÃ¡rio Ã© o mesmo,
 * sÃ³ muda o destino.
 */
export async function updateAccountAction(formData: FormData): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Registro nÃ£o identificado." };

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
    return { ok: true, message: "AlteraÃ§Ãµes salvas." };
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
    return { ok: true, message: "Carteira excluÃ­da. Os lanÃ§amentos foram mantidos." };
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

export async function deleteIncomeSourceAction(id: string): Promise<ActionResult> {
  // Server Action e endpoint HTTP publico: exige sessao antes de tocar em dado.
  if (!(await currentUserId())) return DENIED;

  try {
    await repo.deleteIncomeSource(id);
    revalidateFinance();
    revalidatePath("/carteiras");
    return { ok: true, message: "Fonte excluÃ­da. Os lanÃ§amentos foram mantidos." };
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
    return { ok: true, message: "Compra e todas as parcelas excluÃ­das." };
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
    return { ok: true, message: "Conta excluÃ­da." };
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
  if (!parsed.success) return { ok: false, error: "Valor invÃ¡lido." };

  try {
    await repo.addToGoal(id, parsed.data.target);
    revalidatePath("/economia");
    return { ok: true, message: "Valor somado Ã  meta." };
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
    return { ok: true, message: "Meta excluÃ­da." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ----------------------------------------------------------------- cenÃ¡rios

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
    return { ok: true, message: "CenÃ¡rio criado." };
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
    return { ok: true, message: "CenÃ¡rio excluÃ­do." };
  } catch (e) {
    return { ok: false, error: mensagemDeErro(e) };
  }
}

// ------------------------------------------------- adaptadores p/ formulÃ¡rio

/**
 * `useActionState` chama a action como `(estadoAnterior, formData)`, enquanto
 * as actions acima recebem sÃ³ o `formData` â€” assinatura mais simples para quem
 * chama direto (botÃ£o, cÃ³digo). Estes adaptadores ligam os dois formatos sem
 * duplicar regra de negÃ³cio.
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
 * Traduz erro do banco para linguagem de gente â€” sem devolver o original.
 *
 * A versÃ£o anterior colava a mensagem crua do SQLite na tela para facilitar o
 * relato de bug na beta. O preÃ§o era alto demais: ia junto o nome de tabela e
 * coluna, o caminho do arquivo do banco e o texto de `assertFinanceStorageMode`,
 * que descreve como o servidor guarda os dados. Isso Ã© mapa do alvo entregue a
 * qualquer um que consiga provocar um erro.
 *
 * O relato continua possÃ­vel pelo ID de correlaÃ§Ã£o: o mesmo cÃ³digo aparece no
 * log do servidor, com a exceÃ§Ã£o inteira. Quem usa informa oito caracteres;
 * quem investiga acha o erro completo.
 *
 * Os casos PREVISTOS continuam com mensagem amigÃ¡vel â€” ali a traduÃ§Ã£o ajuda,
 * porque "UNIQUE constraint failed: categories.name" nÃ£o diz nada a ninguÃ©m.
 */
function mensagemDeErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (raw.includes("UNIQUE constraint failed: categories.name")) {
    return "JÃ¡ existe uma categoria com esse nome.";
  }
  if (raw.includes("UNIQUE constraint failed: accounts.name")) {
    return "JÃ¡ existe uma conta ou cartÃ£o com esse apelido. Use outro nome.";
  }
  if (raw.includes("UNIQUE constraint failed: income_sources.name")) {
    return "JÃ¡ existe uma empresa com esse nome.";
  }
  if (raw.includes("FOREIGN KEY constraint failed")) {
    return "Registro relacionado invÃ¡lido ou removido. Recarregue a pÃ¡gina.";
  }
  if (raw.includes("CHECK constraint failed: accounts")) {
    return "Valor fora do permitido no cadastro da conta. Confira os campos e tente de novo.";
  }
  if (raw.includes("CHECK constraint failed")) {
    return "Algum valor estÃ¡ fora do permitido. Confira os campos e tente de novo.";
  }
  if (raw.includes("NOT NULL constraint failed")) {
    return "Faltou preencher um campo obrigatÃ³rio.";
  }

  const id = randomUUID().slice(0, 8);
  console.error(`[actions] erro nÃ£o tratado ${id}:`, e);
  return `NÃ£o foi possÃ­vel concluir a operaÃ§Ã£o. Informe o cÃ³digo ${id} ao suporte.`;
}


"use client";

import { useState } from "react";

import { AddDialog, EditDialog } from "./add-dialog";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { createBillForm, updateBillForm } from "@/lib/actions";
import { KIND_LABEL, type Bill, type Category } from "@/lib/types";

/**
 * Botão + popup do cadastro de conta.
 *
 * Vive aqui, e não na página, porque `AddDialog` recebe os filhos como função
 * — e função não atravessa a fronteira de Server Component. Sendo este arquivo
 * "use client", o render prop fica todo do lado do cliente.
 */
export function BillFormDialog(props: { categories: Category[]; today: string }) {
  return (
    <AddDialog
      label="Cadastrar conta"
      description="Para boleto e conta fixa. A fatura do cartão aparece aqui sozinha, a partir das compras — não cadastre."
    >
      {(fechar) => <BillForm {...props} onSaved={fechar} />}
    </AddDialog>
  );
}

/**
 * Cadastro de conta a pagar. Um formulário só para os dois casos:
 * conta fixa mensal (aluguel, luz, streaming) e boleto avulso (IPVA, matrícula).
 *
 * O campo de vencimento TROCA conforme a recorrência — dia do mês para a fixa,
 * data completa para o boleto. Mostrar os dois ao mesmo tempo obrigaria o
 * usuário a descobrir qual ignorar (divulgação progressiva).
 */
export function BillForm({
  categories,
  today,
  onSaved,
  bill,
}: {
  categories: Category[];
  today: string;
  /** Fecha o popup que embrulha este formulário. */
  onSaved?: () => void;
  /** Conta existente: os mesmos campos passam a editar em vez de cadastrar. */
  bill?: Bill;
}) {
  const [recurrence, setRecurrence] = useState<"MONTHLY" | "ONCE">(
    bill?.recurrence ?? "MONTHLY",
  );

  const grouped = (["NEED", "WANT", "SAVE"] as const).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  // Sem moldura própria: quem embrulha é o popup, que já dá título e borda.
  // O aviso sobre fatura de cartão desce como descrição do popup.
  return (
    <ActionForm
      action={bill ? updateBillForm : createBillForm}
      submitLabel={bill ? "Salvar conta" : "Cadastrar"}
      onSuccess={onSaved}
    >
        {(state) => (
          <>
            {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
            <Field label="Tipo" name="recurrence" required>
              <Select
                id="recurrence"
                name="recurrence"
                value={recurrence}
                onChange={(e) =>
                  setRecurrence(e.target.value as "MONTHLY" | "ONCE")
                }
                required
              >
                <option value="MONTHLY">Conta fixa (todo mês)</option>
                <option value="ONCE">Boleto avulso (uma vez)</option>
              </Select>
            </Field>

            <Field
              label="Nome"
              name="name"
              required
              error={fieldError(state, "name")}
            >
              <Input
                id="name"
                name="name"
                required
                maxLength={60}
                placeholder={recurrence === "MONTHLY" ? "Aluguel" : "IPVA 2026"}
                defaultValue={bill?.name}
              />
            </Field>

            <Field
              label="Valor"
              name="amount"
              required
              error={fieldError(state, "amount")}
              hint="Em conta variável, use o valor médio como estimativa."
            >
              <Input
                id="amount"
                name="amount"
                required
                inputMode="decimal"
                placeholder="1.850,00"
                className="font-mono"
                defaultValue={
                  bill ? (bill.amountCents / 100).toFixed(2).replace(".", ",") : undefined
                }
              />
            </Field>

            {recurrence === "MONTHLY" ? (
              <Field
                label="Dia do vencimento"
                name="dueDay"
                required
                error={fieldError(state, "dueDay")}
                hint="Se cair no dia 31 em mês curto, vence no último dia."
              >
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  min={1}
                  max={31}
                  required
                  defaultValue={bill?.dueDay ?? 10}
                  className="font-mono"
                />
              </Field>
            ) : (
              <Field
                label="Data de vencimento"
                name="dueDate"
                required
                error={fieldError(state, "dueDate")}
              >
                <Input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  required
                  defaultValue={bill?.dueDate ?? today}
                />
              </Field>
            )}

            <Field
              label="Categoria"
              name="categoryId"
              required
              error={fieldError(state, "categoryId")}
            >
              <Select id="categoryId" name="categoryId" required defaultValue={bill?.categoryId}>
                {grouped.map(({ kind, items }) =>
                  items.length ? (
                    <optgroup key={kind} label={KIND_LABEL[kind]}>
                      {items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </Select>
            </Field>

            <Field
              label="Linha digitável"
              name="barcode"
              error={fieldError(state, "barcode")}
              hint="Opcional. Fica só neste computador, para você copiar na hora de pagar."
            >
              <Input
                id="barcode"
                name="barcode"
                maxLength={60}
                className="font-mono text-xs"
                defaultValue={bill?.barcode ?? ""}
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-md text-xs">
              <input
                type="checkbox"
                name="variable"
                defaultChecked={bill?.variable}
                className="size-4 cursor-pointer accent-[var(--color-accent)]"
              />
              O valor muda todo mês (luz, água, telefone)
            </label>
          </>
        )}
    </ActionForm>
  );
}

/** Botão + popup para corrigir uma conta já cadastrada. */
export function BillEditDialog({
  bill,
  categories,
  today,
}: {
  bill: Bill;
  categories: Category[];
  today: string;
}) {
  return (
    <EditDialog title={`Editar ${bill.name}`} ariaLabel={`Editar ${bill.name}`}>
      {(fechar) => (
        <BillForm bill={bill} categories={categories} today={today} onSaved={fechar} />
      )}
    </EditDialog>
  );
}

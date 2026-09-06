"use client";

import { useState } from "react";

import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { createBillForm } from "@/lib/actions";
import { KIND_LABEL, type Category } from "@/lib/types";

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
}: {
  categories: Category[];
  today: string;
}) {
  const [recurrence, setRecurrence] = useState<"MONTHLY" | "ONCE">("MONTHLY");

  const grouped = (["NEED", "WANT", "SAVE"] as const).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  return (
    <section className="glass p-2xl">
      <h2 className="mb-lg text-sm font-semibold tracking-tight">Cadastrar conta</h2>

      {/*
        Fatura de cartão NÃO se cadastra aqui. Ela já entra sozinha nesta lista,
        calculada a partir das compras. Cadastrada à mão viraria uma segunda
        cobrança do mesmo dinheiro — e das duas, só uma some quando você paga.
      */}
      <p className="mb-lg text-xs leading-relaxed text-muted-foreground">
        Para boleto e conta fixa. A fatura do cartão aparece aqui sozinha, a
        partir das compras — não cadastre.
      </p>

      <ActionForm action={createBillForm} submitLabel="Cadastrar">
        {(state) => (
          <>
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
                  defaultValue={10}
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
                  defaultValue={today}
                />
              </Field>
            )}

            <Field
              label="Categoria"
              name="categoryId"
              required
              error={fieldError(state, "categoryId")}
            >
              <Select id="categoryId" name="categoryId" required>
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
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-md text-xs">
              <input
                type="checkbox"
                name="variable"
                className="size-4 cursor-pointer accent-[var(--color-accent)]"
              />
              O valor muda todo mês (luz, água, telefone)
            </label>
          </>
        )}
      </ActionForm>
    </section>
  );
}

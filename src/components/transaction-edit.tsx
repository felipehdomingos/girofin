"use client";

import { useState } from "react";

import { EditDialog } from "./add-dialog";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { updateTransactionForm } from "@/lib/actions";
import {
  KIND_LABEL,
  METHOD_LABEL,
  type Account,
  type Category,
  type IncomeSource,
  type PaymentMethod,
  type Transaction,
} from "@/lib/types";

/**
 * Correção de um lançamento já feito.
 *
 * Edita o que descreve o fato — data, valor, categoria, de onde saiu o
 * dinheiro. Não mexe em parcelamento: a parcela é uma linha de um conjunto, e
 * mudar a estrutura pelo formulário de uma delas deixaria as outras
 * descrevendo uma compra que não existe mais. Parcelamento errado se refaz
 * excluindo a compra inteira, que é o que o botão de excluir já faz.
 */
export function TransactionEditDialog({
  transaction,
  categories,
  accounts,
  incomeSources,
}: {
  transaction: Transaction;
  categories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
}) {
  const [tipo, setTipo] = useState(transaction.type);

  const grouped = (["NEED", "WANT", "SAVE"] as const).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  return (
    <EditDialog
      title={`Editar ${transaction.description}`}
      ariaLabel={`Editar ${transaction.description}`}
      className="p-sm"
    >
      {(fechar) => (
        <ActionForm
          action={updateTransactionForm}
          submitLabel="Salvar lançamento"
          onSuccess={fechar}
        >
          {(state) => (
            <>
              <input type="hidden" name="id" value={transaction.id} />

              {transaction.purchaseId ? (
                <p className="rounded-control border border-border bg-muted/40 p-lg text-xs text-muted-foreground">
                  Esta é a parcela {transaction.installmentNo} de{" "}
                  {transaction.installmentTotal}. O parcelamento em si não muda por
                  aqui — para refazer, exclua a compra e lance de novo.
                </p>
              ) : null}

              <Field label="Tipo" name="type" required>
                <Select
                  id="tx-type"
                  name="type"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as typeof tipo)}
                  required
                >
                  <option value="EXPENSE">Saída</option>
                  <option value="INCOME">Entrada</option>
                </Select>
              </Field>

              <Field
                label="Descrição"
                name="description"
                required
                error={fieldError(state, "description")}
              >
                <Input
                  id="tx-description"
                  name="description"
                  required
                  maxLength={120}
                  defaultValue={transaction.description}
                />
              </Field>

              <Field label="Valor" name="amount" required error={fieldError(state, "amount")}>
                <Input
                  id="tx-amount"
                  name="amount"
                  required
                  inputMode="decimal"
                  className="font-mono"
                  defaultValue={(transaction.amountCents / 100).toFixed(2).replace(".", ",")}
                />
              </Field>

              <Field label="Data" name="date" required error={fieldError(state, "date")}>
                <Input
                  id="tx-date"
                  name="date"
                  type="date"
                  required
                  defaultValue={transaction.date}
                />
              </Field>

              <Field
                label="Categoria"
                name="categoryId"
                required
                error={fieldError(state, "categoryId")}
              >
                <Select
                  id="tx-category"
                  name="categoryId"
                  required
                  defaultValue={transaction.categoryId}
                >
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

              {/* Entrada vem de uma fonte de renda; saída sai de uma carteira.
                  Mostrar os dois ao mesmo tempo obrigaria a descobrir qual
                  ignorar. */}
              {tipo === "INCOME" ? (
                <Field label="Fonte de renda" name="incomeSourceId" hint="Opcional.">
                  <Select
                    id="tx-source"
                    name="incomeSourceId"
                    defaultValue={transaction.incomeSourceId ?? ""}
                  >
                    <option value="">Não informar</option>
                    {incomeSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Saiu de" name="accountId" hint="Opcional.">
                  <Select
                    id="tx-account"
                    name="accountId"
                    defaultValue={transaction.accountId ?? ""}
                  >
                    <option value="">Não informar</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Forma de pagamento" name="method" hint="Opcional.">
                <Select id="tx-method" name="method" defaultValue={transaction.method ?? ""}>
                  <option value="">Não informar</option>
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </EditDialog>
  );
}

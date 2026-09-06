"use client";

import { useState } from "react";

import { ActionButton } from "./action-button";
import { ColorPicker } from "./bank-picker";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { Badge, Card, CardTitle, CategoryDot, Money, ProgressBar } from "./ui";
import { createCategoryForm, updateBudgetAction } from "@/lib/actions";
import { VIZ_PALETTE } from "@/lib/palette";
import { formatBRL, safePercent } from "@/lib/money";
import { KIND_LABEL, type Category, type CategoryKind } from "@/lib/types";

/**
 * Categorias + orçamento mensal.
 *
 * O orçamento é o que transforma o app de retrovisor em alerta: sem teto, o
 * sistema só conta o que já aconteceu; com teto, ele avisa antes de estourar.
 */
export function CategoryManager({
  categories,
  spentByCategory,
  nextColor,
}: {
  categories: Category[];
  spentByCategory: Record<string, number>;
  nextColor: string;
}) {
  const [cor, setCor] = useState(nextColor);
  const [budgets, setBudgets] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((c) => [
        c.id,
        c.budgetCents ? (c.budgetCents / 100).toFixed(2).replace(".", ",") : "",
      ]),
    ),
  );

  const grouped = (["NEED", "WANT", "SAVE"] as CategoryKind[]).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  return (
    <div className="grid gap-xl lg:grid-cols-[1.5fr_1fr]">
      <div className="flex flex-col gap-xl">
        {grouped.map(({ kind, items }) =>
          items.length === 0 ? null : (
            <Card key={kind}>
              <CardTitle
                hint={`${items.length} ${items.length === 1 ? "categoria" : "categorias"}`}
              >
                {KIND_LABEL[kind]}
              </CardTitle>

              <ul className="flex flex-col gap-xl">
                {items.map((c) => {
                  const spent = spentByCategory[c.id] ?? 0;
                  const usedPct = c.budgetCents
                    ? safePercent(spent, c.budgetCents)
                    : null;
                  const over = usedPct !== null && usedPct > 100;

                  return (
                    <li key={c.id}>
                      <div className="mb-md flex flex-wrap items-center justify-between gap-md">
                        <span className="flex items-center gap-md text-sm">
                          <CategoryDot color={c.color} />
                          {c.name}
                        </span>

                        <span className="flex items-center gap-md">
                          <span className="text-xs text-muted-foreground">
                            gasto no mês
                          </span>
                          <Money cents={spent} size="sm" />
                          {usedPct !== null ? (
                            <Badge tone={over ? "negative" : "neutral"}>
                              {usedPct.toFixed(0)}% do teto
                            </Badge>
                          ) : null}
                        </span>
                      </div>

                      {c.budgetCents ? (
                        <ProgressBar
                          value={spent}
                          max={c.budgetCents}
                          label={`${c.name}: ${(usedPct ?? 0).toFixed(0)}% do orçamento`}
                          tone={over ? "negative" : usedPct! > 80 ? "warning" : "positive"}
                        />
                      ) : null}

                      <div className="mt-md flex flex-wrap items-center gap-md">
                        <label
                          htmlFor={`budget-${c.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Teto mensal
                        </label>
                        <input
                          id={`budget-${c.id}`}
                          value={budgets[c.id] ?? ""}
                          onChange={(e) =>
                            setBudgets((p) => ({ ...p, [c.id]: e.target.value }))
                          }
                          inputMode="decimal"
                          placeholder="sem teto"
                          className="w-28 rounded-control border border-border bg-muted px-md py-sm font-mono text-xs"
                        />
                        <ActionButton
                          action={() => updateBudgetAction(c.id, budgets[c.id] ?? "")}
                          className="rounded-control border border-border px-lg py-sm text-xs font-semibold hover:bg-muted"
                        >
                          Salvar
                        </ActionButton>
                        {c.budgetCents ? (
                          <span className="text-[11px] text-muted-foreground">
                            atual: {formatBRL(c.budgetCents)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ),
        )}
      </div>

      <Card>
        <CardTitle>Nova categoria</CardTitle>

        <ActionForm action={createCategoryForm} submitLabel="Criar categoria">
          {(state) => (
            <>
              <Field label="Nome" name="name" required error={fieldError(state, "name")}>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={40}
                  placeholder="Pet"
                />
              </Field>

              <Field
                label="Tipo"
                name="kind"
                required
                hint="Define como a categoria entra na regra 50/30/20."
              >
                <Select id="kind" name="kind" defaultValue="WANT" required>
                  <option value="NEED">Essencial — não dá para cortar</option>
                  <option value="WANT">Desejo — qualidade de vida</option>
                  <option value="SAVE">Poupança — guardar ou investir</option>
                </Select>
              </Field>

              <Field
                label="Cor no gráfico"
                name="color"
                error={fieldError(state, "color")}
                hint="Paleta validada para contraste e daltonismo."
              >
                <ColorPicker
                  name="color"
                  value={cor}
                  onChange={setCor}
                  palette={VIZ_PALETTE}
                />
              </Field>

              <Field
                label="Teto mensal"
                name="budget"
                error={fieldError(state, "budget")}
                hint="Opcional. Sem teto, a categoria não gera alerta de estouro."
              >
                <Input
                  id="budget"
                  name="budget"
                  inputMode="decimal"
                  placeholder="300,00"
                  className="font-mono"
                />
              </Field>

              <input type="hidden" name="icon" value="circle" />
            </>
          )}
        </ActionForm>
      </Card>
    </div>
  );
}

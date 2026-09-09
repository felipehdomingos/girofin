"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { ActionButton } from "./action-button";
import { AddDialog } from "./add-dialog";
import { ColorPicker } from "./bank-picker";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { Badge, Card, CardTitle, CategoryDot, Money, ProgressBar } from "./ui";
import { createCategoryForm, deleteCategoryAction, updateCategoryForm } from "@/lib/actions";
import { VIZ_PALETTE } from "@/lib/palette";
import { formatBRL, safePercent } from "@/lib/money";
import { KIND_LABEL, type Category, type CategoryKind } from "@/lib/types";

/**
 * Campos da categoria. Os mesmos para cadastrar e editar — duplicar seria duas
 * telas para manter em sincronia.
 */
function CamposCategoria({
  categoria,
  cor,
  setCor,
  state,
}: {
  categoria?: Category;
  cor: string;
  setCor: (hex: string) => void;
  state: Parameters<Parameters<typeof ActionForm>[0]["children"]>[0];
}) {
  return (
    <>
      {categoria ? <input type="hidden" name="id" value={categoria.id} /> : null}

      <Field label="Nome" name="name" required error={fieldError(state, "name")}>
        <Input id="name" name="name" required maxLength={40} placeholder="Pet" defaultValue={categoria?.name} />
      </Field>

      <Field
        label="Tipo"
        name="kind"
        required
        hint="Define como a categoria entra na regra 50/30/20."
      >
        <Select id="kind" name="kind" defaultValue={categoria?.kind ?? "WANT"} required>
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
        <ColorPicker name="color" value={cor} onChange={setCor} palette={VIZ_PALETTE} />
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
          defaultValue={
            categoria?.budgetCents
              ? (categoria.budgetCents / 100).toFixed(2).replace(".", ",")
              : ""
          }
        />
      </Field>

      <input type="hidden" name="icon" value={categoria?.icon ?? "circle"} />
    </>
  );
}

/** Botão "Editar" de uma linha, com o popup do mesmo formulário. */
function EditarCategoria({ categoria }: { categoria: Category }) {
  const [aberto, setAberto] = useState(false);
  const [cor, setCor] = useState(categoria.color);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex cursor-pointer items-center gap-sm rounded-control border border-border px-lg py-sm text-xs font-semibold transition-colors duration-200 hover:bg-muted"
      >
        <Pencil className="size-3" aria-hidden="true" />
        Editar
      </button>

      {/* Sem botão próprio: quem abre é o "Editar" acima. */}
      <AddDialog
        label={`Editar ${categoria.name}`}
        title="Editar categoria"
        open={aberto}
        onOpenChange={setAberto}
        hideTrigger
      >
        {(fechar) => (
          <ActionForm action={updateCategoryForm} submitLabel="Salvar categoria" onSuccess={fechar}>
            {(state) => (
              <CamposCategoria categoria={categoria} cor={cor} setCor={setCor} state={state} />
            )}
          </ActionForm>
        )}
      </AddDialog>
    </>
  );
}

/**
 * Categorias + orçamento mensal.
 *
 * O orçamento é o que transforma o app de retrovisor em alerta: sem teto, o
 * sistema só conta o que já aconteceu; com teto, ele avisa antes de estourar.
 * O teto se define no cadastro e na edição — antes havia um campo solto em
 * cada linha, com um "Salvar" só dele, que era um formulário escondido no meio
 * da lista.
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

  const grouped = (["NEED", "WANT", "SAVE"] as CategoryKind[]).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  return (
    <div className="flex flex-col gap-xl">
      <div className="flex justify-end">
        <AddDialog label="Nova categoria" title="Nova categoria">
          {(fechar) => (
            <ActionForm action={createCategoryForm} submitLabel="Criar categoria" onSuccess={fechar}>
              {(state) => <CamposCategoria cor={cor} setCor={setCor} state={state} />}
            </ActionForm>
          )}
        </AddDialog>
      </div>

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
                const usedPct = c.budgetCents ? safePercent(spent, c.budgetCents) : null;
                const over = usedPct !== null && usedPct > 100;

                return (
                  <li key={c.id}>
                    <div className="mb-md flex flex-wrap items-center justify-between gap-md">
                      <span className="min-w-0">
                        <span className="flex items-center gap-md text-sm">
                          <CategoryDot color={c.color} />
                          {c.name}
                        </span>
                        {/* O teto aparece como texto, e a ausência dele também:
                            campo vazio não conta que existe a possibilidade. */}
                        <span className="mt-xs block pl-xl text-[11px] text-muted-foreground">
                          {c.budgetCents
                            ? `Teto de ${formatBRL(c.budgetCents)} por mês`
                            : "Sem teto de gastos definido"}
                        </span>
                      </span>

                      <span className="flex items-center gap-md">
                        <span className="text-xs text-muted-foreground">gasto no mês</span>
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
                      <EditarCategoria categoria={c} />
                      <ActionButton
                        action={() => deleteCategoryAction(c.id)}
                        confirm
                        confirmLabel="Excluir?"
                        ariaLabel={`Excluir ${c.name}`}
                        className="rounded-control border border-border px-lg py-sm text-xs font-semibold text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-neg"
                      >
                        Excluir
                      </ActionButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ),
      )}
    </div>
  );
}

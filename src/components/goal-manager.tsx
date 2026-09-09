"use client";

import { useState } from "react";
import { Target, Trash2 } from "lucide-react";

import { ActionButton } from "./action-button";
import { ActionForm, Field, Input, fieldError } from "./form-kit";
import { Card, CardTitle, EmptyState, Money, ProgressBar } from "./ui";
import { AddDialog, EditDialog } from "./add-dialog";
import { addToGoalAction, createGoalForm, deleteGoalAction, updateGoalForm } from "@/lib/actions";
import { monthsToReach } from "@/lib/finance";
import { formatBRL, safePercent } from "@/lib/money";
import type { Goal } from "@/lib/types";

/**
 * Metas de economia.
 *
 * Cada meta mostra o que falta E uma estimativa de prazo, calculada com a taxa
 * real do CDI. Uma barra de progresso sozinha diz "você está em 34%"; a
 * pergunta que a pessoa tem é "quando eu chego lá?".
 */
/** Campos da meta. Os mesmos para criar e editar. */
function CamposMeta({
  meta,
  state,
}: {
  meta?: Goal;
  state: Parameters<Parameters<typeof ActionForm>[0]["children"]>[0];
}) {
  return (
    <>
      {meta ? <input type="hidden" name="id" value={meta.id} /> : null}

      <Field label="Nome" name="name" required error={fieldError(state, "name")}>
        <Input
          id="name"
          name="name"
          required
          maxLength={60}
          placeholder="Reserva de emergência"
          defaultValue={meta?.name}
        />
      </Field>

      <Field
        label="Quanto quero juntar"
        name="target"
        required
        error={fieldError(state, "target")}
      >
        <Input
          id="target"
          name="target"
          required
          inputMode="decimal"
          placeholder="30.000,00"
          className="font-mono"
          defaultValue={
            meta ? (meta.targetCents / 100).toFixed(2).replace(".", ",") : undefined
          }
        />
      </Field>

      <Field
        label="Já tenho guardado"
        name="saved"
        error={fieldError(state, "saved")}
        hint="Opcional."
      >
        <Input
          id="saved"
          name="saved"
          inputMode="decimal"
          placeholder="0,00"
          className="font-mono"
          defaultValue={
            meta ? (meta.savedCents / 100).toFixed(2).replace(".", ",") : undefined
          }
        />
      </Field>

      <Field label="Prazo" name="deadline" hint="Opcional.">
        <Input id="deadline" name="deadline" type="date" defaultValue={meta?.deadline ?? ""} />
      </Field>
    </>
  );
}

function EditarMeta({ meta }: { meta: Goal }) {
  return (
    <EditDialog title="Editar meta" ariaLabel={`Editar ${meta.name}`}>
      {(fechar) => (
        <ActionForm action={updateGoalForm} submitLabel="Salvar meta" onSuccess={fechar}>
          {(state) => <CamposMeta meta={meta} state={state} />}
        </ActionForm>
      )}
    </EditDialog>
  );
}

export function GoalManager({
  goals,
  annualRatePct,
}: {
  goals: Goal[];
  annualRatePct: number;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardTitle
        hint={
          <AddDialog label="Nova meta" title="Nova meta" className="px-lg py-sm text-xs">
            {(fechar) => (
              <ActionForm action={createGoalForm} submitLabel="Criar meta" onSuccess={fechar}>
                {(state) => <CamposMeta state={state} />}
              </ActionForm>
            )}
          </AddDialog>
        }
      >
        Metas
      </CardTitle>



      {goals.length === 0 ? (
        <EmptyState title="Nenhuma meta ainda">
          Meta com número e prazo funciona melhor que “economizar mais”. Comece pela
          reserva de emergência: 6 meses do seu custo mensal.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-xl">
          {goals.map((g) => {
            const pct = safePercent(g.savedCents, g.targetCents);
            const missing = Math.max(g.targetCents - g.savedCents, 0);
            const done = missing === 0;

            return (
              <li key={g.id}>
                <div className="mb-md flex flex-wrap items-baseline justify-between gap-md">
                  <span className="flex items-center gap-md text-sm font-medium">
                    <Target className="size-4 text-muted-foreground" aria-hidden="true" />
                    {g.name}
                  </span>
                  <span className="flex items-baseline gap-md text-xs text-muted-foreground">
                    <Money cents={g.savedCents} size="sm" tone="positive" />
                    <span>de</span>
                    <Money cents={g.targetCents} size="sm" />
                    <span className="font-mono tabular">{pct.toFixed(0)}%</span>
                  </span>
                </div>

                <ProgressBar
                  value={g.savedCents}
                  max={g.targetCents}
                  label={`${g.name}: ${pct.toFixed(0)}% concluído`}
                  tone={done ? "positive" : "neutral"}
                />

                <div className="mt-md flex flex-wrap items-center justify-between gap-md">
                  <p className="text-xs text-muted-foreground">
                    {done ? (
                      <span className="text-pos">Meta atingida.</span>
                    ) : (
                      <>Faltam {formatBRL(missing)}.</>
                    )}
                  </p>

                  <div className="flex items-center gap-md">
                    <label className="sr-only" htmlFor={`add-${g.id}`}>
                      Somar valor a {g.name}
                    </label>
                    <input
                      id={`add-${g.id}`}
                      value={amounts[g.id] ?? ""}
                      onChange={(e) =>
                        setAmounts((p) => ({ ...p, [g.id]: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-24 rounded-control border border-border bg-muted px-md py-sm font-mono text-xs"
                    />
                    <ActionButton
                      action={() => addToGoalAction(g.id, amounts[g.id] ?? "")}
                      onDone={(r) => {
                        if (r.ok) setAmounts((p) => ({ ...p, [g.id]: "" }));
                      }}
                      className="rounded-control border border-border px-lg py-sm text-xs font-semibold hover:bg-muted"
                    >
                      Somar
                    </ActionButton>
                    <EditarMeta meta={g} />
                    <ActionButton
                      action={() => deleteGoalAction(g.id)}
                      confirm
                      confirmLabel="Excluir?"
                      ariaLabel={`Excluir meta ${g.name}`}
                      className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </ActionButton>
                  </div>
                </div>

                {!done ? <GoalEta goal={g} annualRatePct={annualRatePct} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * Estimativa de prazo. Usa o ritmo dos últimos aportes como aproximação —
 * sem histórico de aporte, mostra o que seria preciso guardar por mês.
 */
function GoalEta({ goal, annualRatePct }: { goal: Goal; annualRatePct: number }) {
  const missing = goal.targetCents - goal.savedCents;
  // Referência de 10% do que falta por mês, só para dar ordem de grandeza.
  const reference = Math.max(Math.round(missing * 0.1), 1);

  const months = monthsToReach({
    initialCents: goal.savedCents,
    monthlyCents: reference,
    targetCents: goal.targetCents,
    annualPct: annualRatePct,
  });

  if (months === null) return null;

  return (
    <p className="mt-sm text-[11px] text-muted-foreground">
      Guardando {formatBRL(reference)} por mês a{" "}
      {annualRatePct.toFixed(1).replace(".", ",")}% a.a., você chega em {months}{" "}
      {months === 1 ? "mês" : "meses"}.
    </p>
  );
}

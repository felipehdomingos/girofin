"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Sparkles, Trash2, TriangleAlert } from "lucide-react";

import { commitBulkAction, previewBulkAction } from "@/lib/actions";
import { formatBRL } from "@/lib/money";
import {
  METHOD_ACCOUNT_KINDS,
  METHOD_ACCOUNT_LABEL,
  METHOD_LABEL,
  type Account,
  type Category,
  type IncomeSource,
  type PaymentMethod,
  type TxNature,
} from "@/lib/types";
import type { ParsedEntry } from "@/lib/categorize";

/**
 * Lançamento rápido: escreve o dia inteiro em texto, o app interpreta e
 * categoriza, você confere e salva.
 *
 * O fluxo é de DOIS PASSOS de propósito (interpretar -> revisar -> salvar).
 * Salvar direto seria um clique a menos e um problema a mais: gasto na
 * categoria errada não dá erro, só envenena silenciosamente o diagnóstico do
 * mês. A revisão é barata; o erro silencioso é caro.
 *
 * Palpite de baixa confiança chega destacado, para o olho ir direto no que
 * precisa de decisão em vez de reler tudo.
 */

interface Row extends ParsedEntry {
  /** Categoria escolhida na revisão (pode diferir do palpite). */
  chosenCategoryId: string;
  date: string;
  /** true quando o usuário trocou a categoria — vira regra aprendida. */
  corrected: boolean;
  chosenNature: TxNature;
  chosenInstallments: number | null;
  chosenAccountId: string;
  chosenIncomeSourceId: string;
  chosenMethod: PaymentMethod | "";
}

const LIMIAR_CONFIANCA = 0.5;

export function QuickEntry({
  categories,
  accounts,
  incomeSources,
  today,
  bare = false,
  onSaved,
}: {
  categories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
  today: string;
  /** Dentro do modal, o card e o título vêm do próprio modal. */
  bare?: boolean;
  /** Chamado após salvar com sucesso — usado para fechar o modal. */
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fallbackCategoryId = categories[0]?.id ?? "";

  function handlePreview() {
    setError(null);
    setOkMessage(null);

    startTransition(async () => {
      const result = await previewBulkAction(text);
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setRows(
        result.entries.map((e) => ({
          ...e,
          chosenCategoryId: e.categoryId ?? fallbackCategoryId,
          date: today,
          corrected: false,
          chosenNature: e.nature,
          chosenInstallments: e.installments,
          chosenAccountId: "",
          chosenMethod: e.method ?? "",
          // Entrada já vem com a primeira fonte pré-selecionada; saída não usa.
          chosenIncomeSourceId:
            e.type === "INCOME" ? (incomeSources[0]?.id ?? "") : "",
        })),
      );
    });
  }

  function handleCommit() {
    if (!rows || rows.length === 0) return;
    setError(null);

    // Barra antes de mandar ao servidor: toda linha precisa de conta, senão o
    // saldo das contas para de bater com o total do mês.
    const semConta = rows.filter((r) => !r.chosenAccountId);
    if (semConta.length > 0) {
      setError(
        semConta.length === 1
          ? `Escolha a conta de "${semConta[0].description}".`
          : `${semConta.length} lançamentos estão sem conta. Escolha de onde saiu cada um.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await commitBulkAction(
        rows.map((r) => ({
          description: r.description,
          amountCents: r.amountCents,
          type: r.type,
          categoryId: r.chosenCategoryId,
          date: r.date,
          nature: r.chosenNature,
          installments:
            r.chosenNature === "PARCELADO" ? (r.chosenInstallments ?? 2) : null,
          accountId: r.chosenAccountId || null,
          incomeSourceId: r.chosenIncomeSourceId || null,
          method: r.chosenMethod || null,
          matchedKeyword: r.matchedKeyword,
          corrected: r.corrected,
        })),
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOkMessage(result.message ?? "Salvo.");
      setRows(null);
      setText("");
      // Delay curto: fechar instantaneamente engoliria a confirmação e
      // deixaria a dúvida de se salvou mesmo.
      if (onSaved) setTimeout(onSaved, 900);
    });
  }

  const lowConfidence = rows?.filter((r) => r.confidence < LIMIAR_CONFIANCA).length ?? 0;
  const total = rows?.reduce(
    (acc, r) => acc + (r.type === "EXPENSE" ? r.amountCents : -r.amountCents),
    0,
  );

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper className={bare ? "" : "glass p-2xl"}>
      {bare ? null : (
        <div className="mb-lg flex items-center gap-md">
          <Sparkles className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">Lançamento rápido</h2>
        </div>
      )}

      <label htmlFor="quick-text" className="block text-xs text-muted-foreground">
        Um por linha: <code className="font-mono">descrição valor</code>. Use{" "}
        <code className="font-mono">+</code> na frente para entrada e{" "}
        <code className="font-mono">4x</code> para parcelar
        (<code className="font-mono">tenis 380 4x</code> = total 380;{" "}
        <code className="font-mono">tenis 4x 95</code> = 4 parcelas de 95).
      </label>

      <textarea
        id="quick-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter interpreta sem tirar a mão do teclado — é lançamento
          // de todo dia, o atalho paga o aprendizado rápido.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handlePreview();
          }
        }}
        rows={5}
        spellCheck={false}
        placeholder={"mercado 152,30\nuber 28\ntenis 380 4x\n+salario 5400"}
        className="mt-md w-full resize-y rounded-control border border-border bg-muted p-lg font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
      />

      <div className="mt-lg flex flex-wrap items-center gap-lg">
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPending || !text.trim()}
          className="inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Interpretar
        </button>
        <span className="text-xs text-muted-foreground">
          ou <kbd className="font-mono">Ctrl</kbd> + <kbd className="font-mono">Enter</kbd>
        </span>
      </div>

      {/* role=alert: o erro é anunciado por leitor de tela, não só visível. */}
      {error ? (
        <p
          role="alert"
          className="mt-lg flex items-start gap-md rounded-control border border-destructive/40 bg-destructive/10 p-lg text-xs text-neg"
        >
          <TriangleAlert className="mt-xs size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {okMessage ? (
        <p
          role="status"
          className="mt-lg flex items-center gap-md rounded-control border border-accent/40 bg-accent/10 p-lg text-xs text-pos"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {okMessage}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="mt-xl">
          <div className="mb-lg flex flex-wrap items-baseline justify-between gap-md">
            <h3 className="text-sm font-semibold">
              Confira antes de salvar
              <span className="ml-md font-normal text-muted-foreground">
                {rows.length} {rows.length === 1 ? "lançamento" : "lançamentos"}
              </span>
            </h3>
            {typeof total === "number" ? (
              <span className="font-mono tabular text-sm">
                total {formatBRL(Math.abs(total))}
              </span>
            ) : null}
          </div>

          {lowConfidence > 0 ? (
            <p className="mb-lg rounded-control border border-amber-500/40 bg-amber-500/10 p-lg text-xs text-amber-200">
              {lowConfidence === 1
                ? "1 lançamento ficou sem palpite confiável — confira a categoria destacada."
                : `${lowConfidence} lançamentos ficaram sem palpite confiável — confira as categorias destacadas.`}
            </p>
          ) : null}

          <ul className="flex flex-col gap-md">
            {rows.map((row, i) => {
              const incerto = row.confidence < LIMIAR_CONFIANCA;
              return (
                <li
                  key={`${row.raw}-${i}`}
                  /* Duas linhas, não uma: descrição + valor em cima, controles
                     embaixo. Numa linha só, os 6 controles espremiam a
                     descrição a ponto de ela quebrar letra a letra. */
                  className={`flex flex-col gap-md rounded-control border p-lg ${
                    incerto ? "border-amber-500/40 bg-amber-500/5" : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-lg">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{row.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.type === "INCOME" ? "entrada" : "saída"}
                        {row.matchedKeyword && !row.corrected
                          ? ` · reconhecido por “${row.matchedKeyword}”`
                          : row.corrected
                            ? " · corrigido por você"
                            : " · sem palpite"}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block font-mono tabular text-sm">
                        {formatBRL(row.amountCents)}
                      </span>
                      {/* Em parcelado, o valor grande é o TOTAL — o que pesa no
                          mês é a parcela, então ela aparece logo abaixo. */}
                      {row.chosenNature === "PARCELADO" && row.chosenInstallments ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {row.chosenInstallments}x de{" "}
                          {formatBRL(
                            Math.floor(row.amountCents / row.chosenInstallments),
                          )}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-md">

                  <label className="sr-only" htmlFor={`nature-${i}`}>
                    Tipo de gasto de {row.description}
                  </label>
                  <select
                    id={`nature-${i}`}
                    value={row.chosenNature}
                    onChange={(e) => {
                      const value = e.target.value as TxNature;
                      setRows((prev) =>
                        prev
                          ? prev.map((r, ri) =>
                              ri === i
                                ? {
                                    ...r,
                                    chosenNature: value,
                                    // Virar parcelado sem número definido cai
                                    // em 2x, o mínimo que faz sentido.
                                    chosenInstallments:
                                      value === "PARCELADO"
                                        ? (r.chosenInstallments ?? 2)
                                        : null,
                                  }
                                : r,
                            )
                          : prev,
                      );
                    }}
                    className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs text-foreground"
                  >
                    <option value="VISTA">À vista</option>
                    <option value="FIXO">Custo fixo</option>
                    <option value="PARCELADO">Parcelado</option>
                  </select>

                  {row.chosenNature === "PARCELADO" ? (
                    <>
                      <label className="sr-only" htmlFor={`parc-${i}`}>
                        Número de parcelas de {row.description}
                      </label>
                      <input
                        id={`parc-${i}`}
                        type="number"
                        min={2}
                        max={72}
                        value={row.chosenInstallments ?? 2}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setRows((prev) =>
                            prev
                              ? prev.map((r, ri) =>
                                  ri === i ? { ...r, chosenInstallments: value } : r,
                                )
                              : prev,
                          );
                        }}
                        className="w-16 rounded-control border border-border bg-muted px-md py-sm font-mono text-xs"
                      />
                    </>
                  ) : null}

                  <label className="sr-only" htmlFor={`cat-${i}`}>
                    Categoria de {row.description}
                  </label>
                  <select
                    id={`cat-${i}`}
                    value={row.chosenCategoryId}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) =>
                        prev
                          ? prev.map((r, ri) =>
                              ri === i
                                ? {
                                    ...r,
                                    chosenCategoryId: value,
                                    corrected: value !== r.categoryId,
                                  }
                                : r,
                            )
                          : prev,
                      );
                    }}
                    className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs text-foreground"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <label className="sr-only" htmlFor={`met-${i}`}>
                    Forma de pagamento de {row.description}
                  </label>
                  <select
                    id={`met-${i}`}
                    value={row.chosenMethod}
                    onChange={(e) => {
                      const value = e.target.value as PaymentMethod | "";
                      setRows((prev) =>
                        prev
                          ? prev.map((r, ri) => {
                              if (ri !== i) return r;
                              const contaAtual = accounts.find(
                                (a) => a.id === r.chosenAccountId,
                              );
                              // A conta já escolhida pode não servir para a
                              // nova forma (cartão não recebe pix). Limpa em
                              // vez de deixar a combinação inválida passar.
                              const contaServe =
                                !value ||
                                !contaAtual ||
                                METHOD_ACCOUNT_KINDS[value].includes(contaAtual.kind);
                              return {
                                ...r,
                                chosenMethod: value,
                                chosenAccountId: contaServe ? r.chosenAccountId : "",
                              };
                            })
                          : prev,
                      );
                    }}
                    className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs text-foreground"
                  >
                    <option value="">Forma…</option>
                    {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>

                  {/* A lista de contas segue a forma de pagamento: crédito
                      mostra só cartões, pix e débito mostram só contas. É o que
                      impede um "pix saindo do cartão" e mantém o saldo de cada
                      conta batendo com os lançamentos. */}
                  {accounts.length > 0 ? (
                    <>
                      <label className="sr-only" htmlFor={`acc-${i}`}>
                        {row.chosenMethod
                          ? METHOD_ACCOUNT_LABEL[row.chosenMethod]
                          : "Conta"}{" "}
                        de {row.description}
                      </label>
                      <select
                        id={`acc-${i}`}
                        value={row.chosenAccountId}
                        aria-invalid={
                          row.type === "EXPENSE" &&
                          !!row.chosenMethod &&
                          !row.chosenAccountId
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          setRows((prev) =>
                            prev
                              ? prev.map((r, ri) =>
                                  ri === i ? { ...r, chosenAccountId: value } : r,
                                )
                              : prev,
                          );
                        }}
                        className={`cursor-pointer rounded-control border bg-muted px-md py-sm text-xs text-foreground ${
                          row.type === "EXPENSE" &&
                          row.chosenMethod &&
                          !row.chosenAccountId
                            ? "border-amber-500/60"
                            : "border-border"
                        }`}
                      >
                        <option value="">
                          {row.chosenMethod
                            ? METHOD_ACCOUNT_LABEL[row.chosenMethod] + "…"
                            : "Sem conta"}
                        </option>
                        {(row.chosenMethod
                          ? accounts.filter((a) =>
                              METHOD_ACCOUNT_KINDS[row.chosenMethod as PaymentMethod].includes(
                                a.kind,
                              ),
                            )
                          : accounts
                        ).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.last4 ? ` ••${a.last4}` : ""}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}

                  {row.type === "INCOME" && incomeSources.length > 0 ? (
                    <>
                      <label className="sr-only" htmlFor={`src-${i}`}>
                        Fonte de renda de {row.description}
                      </label>
                      <select
                        id={`src-${i}`}
                        value={row.chosenIncomeSourceId}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRows((prev) =>
                            prev
                              ? prev.map((r, ri) =>
                                  ri === i
                                    ? { ...r, chosenIncomeSourceId: value }
                                    : r,
                                )
                              : prev,
                          );
                        }}
                        className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs text-foreground"
                      >
                        <option value="">Sem fonte</option>
                        {incomeSources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}

                  <label className="sr-only" htmlFor={`date-${i}`}>
                    Data de {row.description}
                  </label>
                  <input
                    id={`date-${i}`}
                    type="date"
                    value={row.date}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) =>
                        prev
                          ? prev.map((r, ri) => (ri === i ? { ...r, date: value } : r))
                          : prev,
                      );
                    }}
                    className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs text-foreground"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => prev?.filter((_, ri) => ri !== i) ?? null)
                    }
                    aria-label={`Remover ${row.description}`}
                    className="cursor-pointer rounded-control p-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-neg"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-xl flex flex-wrap gap-lg">
            <button
              type="button"
              onClick={handleCommit}
              disabled={isPending}
              className="inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Salvar {rows.length}
            </button>
            <button
              type="button"
              onClick={() => setRows(null)}
              className="cursor-pointer rounded-control border border-border px-xl py-md text-sm font-semibold transition-colors duration-200 hover:bg-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </Wrapper>
  );
}

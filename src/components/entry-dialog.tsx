"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { ManualEntry } from "./manual-entry";
import { QuickEntry } from "./quick-entry";
import type { Account, Category, IncomeSource } from "@/lib/types";

/**
 * Novo lançamento em popup, não em página.
 *
 * Usa o <dialog> NATIVO do HTML com showModal(), e não uma div com position
 * fixed. O nativo entrega de graça o que uma div exigiria escrever à mão e
 * quase sempre sai errado: foco preso dentro do modal, Esc para fechar, fundo
 * inerte (não dá para tabular nem clicar atrás), foco devolvido para o botão
 * que abriu, e ::backdrop de verdade.
 *
 * Duas abas porque são dois usos diferentes: o rápido é o de todo dia, o
 * detalhado é para quando precisa de data antiga, parcelamento ou carteira.
 */
export function EntryDialog({
  categories,
  accounts,
  incomeSources,
  today,
  variant = "button",
}: {
  categories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
  today: string;
  /** "fab" = botão flutuante global; "button" = botão comum no cabeçalho. */
  variant?: "button" | "fab";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"rapido" | "detalhado">("rapido");
  const [open, setOpen] = useState(false);

  function abrir() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function fechar() {
    dialogRef.current?.close();
  }

  // O <dialog> fecha sozinho no Esc, sem passar pelo onClick. Sem escutar
  // "close", o estado do React ficaria dessincronizado do DOM.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onClose = () => setOpen(false);
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={
          variant === "fab"
            ? /* Flutuante: acima da barra inferior no mobile, canto no desktop.
                 size-14 é bem acima do mínimo de 44x44 para alvo de toque. */
              "fixed bottom-20 right-xl z-30 flex size-14 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-xl transition-colors duration-200 hover:bg-accent/90 lg:bottom-xl lg:right-2xl"
            : "inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
        }
        aria-label={variant === "fab" ? "Novo lançamento" : undefined}
      >
        <Plus className={variant === "fab" ? "size-6" : "size-4"} aria-hidden="true" />
        {variant === "fab" ? null : "Novo lançamento"}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="titulo-lancamento"
        /* Clique no ::backdrop fecha. O <dialog> entrega o clique do fundo
           como se fosse no próprio dialog, então comparar o alvo é o que
           distingue "clicou fora" de "clicou no conteúdo". */
        onClick={(e) => {
          if (e.target === dialogRef.current) fechar();
        }}
        className="m-auto w-[min(56rem,92vw)] rounded-modal border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-[rgba(2,6,23,0.72)] backdrop:backdrop-blur-sm"
      >
        {/* O conteúdo só monta com o modal aberto: sem isso, os formulários
            manteriam estado de uma abertura anterior (texto meio digitado,
            linhas já interpretadas) na próxima vez que abrisse. */}
        {open ? (
          <div className="max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-lg border-b border-border bg-card px-2xl py-xl">
              <h2 id="titulo-lancamento" className="text-sm font-semibold tracking-tight">
                Novo lançamento
              </h2>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="cursor-pointer rounded-control p-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div
              role="tablist"
              aria-label="Forma de lançar"
              className="flex gap-sm border-b border-border px-2xl pt-lg"
            >
              {(
                [
                  ["rapido", "Rápido"],
                  ["detalhado", "Detalhado"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-lancamento-${id}`}
                  aria-controls="panel-lancamento"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`cursor-pointer border-b-2 px-lg py-md text-sm transition-colors duration-200 ${
                    tab === id
                      ? "border-accent font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              id="panel-lancamento"
              role="tabpanel"
              aria-labelledby={`tab-lancamento-${tab}`}
              className="p-2xl"
            >
              {/*
                Sem conta cadastrada não há como lançar nada de forma íntegra:
                todo gasto sai de algum lugar e toda entrada cai em algum lugar.
                Deixar lançar sem conta produziria lançamentos órfãos que fazem
                a soma das contas divergir do total do mês — e aí nenhum dos
                dois números é confiável. Melhor barrar aqui e mandar cadastrar.
              */}
              {accounts.length === 0 ? (
                <div className="rounded-control border border-amber-500/40 bg-amber-500/10 p-xl text-sm">
                  <p className="font-semibold text-amber-200">
                    Cadastre uma conta antes de lançar
                  </p>
                  <p className="mt-md leading-relaxed text-muted-foreground">
                    Todo gasto sai de algum lugar e toda entrada cai em algum lugar.
                    Sem pelo menos uma conta ou cartão cadastrado, os saldos não
                    fecham com os lançamentos.
                  </p>
                  <Link
                    href="/configuracoes"
                    onClick={fechar}
                    className="mt-lg inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
                  >
                    Cadastrar conta ou cartão
                  </Link>
                </div>
              ) : tab === "rapido" ? (
                <QuickEntry
                  categories={categories}
                  accounts={accounts}
                  incomeSources={incomeSources}
                  today={today}
                  bare
                  onSaved={fechar}
                />
              ) : (
                <ManualEntry
                  categories={categories}
                  accounts={accounts}
                  incomeSources={incomeSources}
                  today={today}
                  bare
                />
              )}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

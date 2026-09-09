"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

/**
 * Botão "adicionar" que abre o cadastro num popup.
 *
 * Existe porque formulário de cadastro não mora mais em coluna lateral. Antes,
 * cada tela reservava metade da largura para um formulário que fica parado a
 * maior parte do tempo — a lista, que é o que a pessoa vem ver, ficava
 * espremida do lado. Agora a tela é da lista e o cadastro é um passo
 * deliberado.
 *
 * O mesmo comportamento do EntryDialog, extraído para não reescrever a
 * mecânica do <dialog> em cada tela.
 */
export function AddDialog({
  label,
  title,
  description,
  children,
  className = "",
}: {
  /** Texto do botão. Também nomeia o popup para leitor de tela. */
  label: string;
  /** Título dentro do popup. Se omitido, usa o `label`. */
  title?: string;
  description?: string;
  /** Recebe a função que fecha o popup — passe para o `onSuccess` do form. */
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const tituloId = `add-dialog-${label.replace(/\W+/g, "-").toLowerCase()}`;

  // Abrir e fechar passam pelo estado, nunca pela ref direto. O `close` desce
  // como render prop e vai parar dentro de um efeito lá embaixo; se ele lesse
  // `dialogRef.current`, seria acesso a ref durante a renderização.
  const fechar = useCallback(() => setOpen(false), []);

  // Fecha e recarrega os dados do servidor: a lista precisa mostrar o que
  // acabou de ser cadastrado.
  const aoSalvar = useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);

  // O estado manda no DOM: <dialog> não abre por atributo, só por showModal().
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

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
        onClick={() => setOpen(true)}
        className={`inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 ${className}`}
      >
        <Plus className="size-4" aria-hidden="true" />
        {label}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        /* Clique no ::backdrop fecha. O <dialog> entrega o clique do fundo
           como se fosse no próprio dialog, então comparar o alvo é o que
           distingue "clicou fora" de "clicou no conteúdo". */
        onClick={(e) => {
          if (e.target === dialogRef.current) fechar();
        }}
        className="m-auto w-[min(38rem,92vw)] rounded-modal border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-[rgba(2,6,23,0.72)] backdrop:backdrop-blur-sm"
      >
        {/* O conteúdo só monta com o popup aberto: sem isso o formulário
            guardaria o que foi meio digitado numa abertura anterior. */}
        {open ? (
          <div className="max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-lg border-b border-border bg-card px-2xl py-xl">
              <div className="min-w-0">
                <h2 id={tituloId} className="text-sm font-semibold tracking-tight">
                  {title ?? label}
                </h2>
                {description ? (
                  <p className="mt-xs text-xs text-muted-foreground">{description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="shrink-0 cursor-pointer rounded-control p-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-2xl py-xl">{children(aoSalvar)}</div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

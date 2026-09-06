"use client";

import { useRef, useState, useTransition } from "react";
import { Check, FileUp, Loader2, Lock, Trash2, TriangleAlert } from "lucide-react";

import { importInvoiceAction } from "@/lib/actions";
import { addMonthsToDate, formatDay } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { parseInvoiceText, parcelasRestantes, type InvoiceLine } from "@/lib/invoice-parser";
import type { Account, Category } from "@/lib/types";

/**
 * Importação de fatura em PDF.
 *
 * O PDF é lido DENTRO DO NAVEGADOR, nunca enviado ao servidor. A fatura é o
 * documento mais sensível do app — tem cada compra sua — e a senha dela costuma
 * ser CPF ou data de nascimento. Lendo aqui, nem o arquivo nem a senha saem
 * desta página: só a lista já interpretada e revisada por você é que vai ao
 * servidor para virar lançamento.
 *
 * O resultado NUNCA é salvo direto. Não existe padrão de fatura no Brasil, e
 * uma leitura errada não dá erro — ela envenena meses de histórico de uma vez.
 */

interface Linha extends InvoiceLine {
  incluir: boolean;
  categoryId: string;
}

export function InvoiceImport({
  card,
  categories,
  periodoPadrao,
}: {
  card: Account;
  categories: Category[];
  /** "YYYY-MM" do mês de vencimento da fatura. */
  periodoPadrao: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [precisaSenha, setPrecisaSenha] = useState(false);
  const [periodo, setPeriodo] = useState(periodoPadrao);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [ignoradas, setIgnoradas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [salvando, startSalvar] = useTransition();

  const catPadrao = categories[0]?.id ?? "";

  async function ler(file: File, comSenha: string) {
    setErro(null);
    setOkMsg(null);
    setLendo(true);

    try {
      // Import dinâmico: o pdf.js tem ~1MB e só faz sentido carregar quando
      // alguém realmente vai importar uma fatura.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const buffer = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        password: comSenha || undefined,
      }).promise;

      const partes: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();

        // Reconstrói as LINHAS pela coordenada Y. O PDF guarda pedaços soltos
        // de texto; sem reagrupar por linha, data, descrição e valor viram
        // três fragmentos sem relação entre si.
        const porLinha = new Map<number, Array<{ x: number; s: string }>>();
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const y = Math.round((item.transform as number[])[5]);
          const x = (item.transform as number[])[4];
          if (!porLinha.has(y)) porLinha.set(y, []);
          porLinha.get(y)!.push({ x, s: item.str });
        }

        for (const [, pedacos] of [...porLinha.entries()].sort((a, b) => b[0] - a[0])) {
          partes.push(
            pedacos
              .sort((a, b) => a.x - b.x)
              .map((p) => p.s)
              .join(" "),
          );
        }
      }

      const resultado = parseInvoiceText(partes.join("\n"), periodo);

      if (resultado.lines.length === 0) {
        setErro(
          "Não encontrei nenhuma compra nesse PDF. Confira se é mesmo a fatura do cartão — ou lance as compras manualmente.",
        );
        setLinhas(null);
        return;
      }

      setLinhas(
        resultado.lines.map((l) => ({ ...l, incluir: true, categoryId: catPadrao })),
      );
      setIgnoradas(resultado.ignoradas);
      setPrecisaSenha(false);
    } catch (e) {
      const nome = (e as { name?: string })?.name ?? "";
      if (nome === "PasswordException") {
        // A senha some da memória junto com a página. Nunca vai ao servidor.
        setPrecisaSenha(true);
        setErro(
          comSenha
            ? "Senha incorreta. Na fatura do Itaú costuma ser os primeiros dígitos do CPF."
            : null,
        );
      } else {
        setErro(`Não consegui ler o PDF: ${(e as Error)?.message ?? "erro desconhecido"}`);
      }
      setLinhas(null);
    } finally {
      setLendo(false);
    }
  }

  function salvar() {
    if (!linhas) return;
    const selecionadas = linhas.filter((l) => l.incluir);
    if (selecionadas.length === 0) {
      setErro("Nenhuma linha selecionada.");
      return;
    }

    startSalvar(async () => {
      const r = await importInvoiceAction(
        card.id,
        selecionadas.map((l) => ({
          description: l.description,
          amountCents: l.amountCents,
          purchaseDate: l.date,
          categoryId: l.categoryId,
          installmentNo: l.installmentNo,
          installmentTotal: l.installmentTotal,
        })),
      );

      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setOkMsg(r.message ?? "Fatura importada.");
      setLinhas(null);
      setArquivo(null);
      setSenha("");
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  const totalSelecionado =
    linhas?.filter((l) => l.incluir).reduce((a, l) => a + l.amountCents, 0) ?? 0;
  const comParcelas = linhas?.filter((l) => parcelasRestantes(l) > 0).length ?? 0;

  return (
    <section className="glass p-2xl">
      <div className="mb-lg flex items-center gap-md">
        <FileUp className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight">Importar fatura (PDF)</h2>
      </div>

      <p className="mb-lg text-xs leading-relaxed text-muted-foreground">
        O PDF é lido <strong>aqui no navegador</strong> — nem o arquivo nem a senha
        saem desta página. Só a lista que você revisar é que vira lançamento.
      </p>

      <div className="flex flex-wrap items-end gap-md">
        <span className="flex flex-col gap-sm">
          <label htmlFor="pdf" className="text-[11px] font-medium">
            Arquivo da fatura
          </label>
          <input
            ref={inputRef}
            id="pdf"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setArquivo(f);
              setLinhas(null);
              setPrecisaSenha(false);
              setErro(null);
              if (f) void ler(f, "");
            }}
            className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-xs file:mr-md file:cursor-pointer file:rounded file:border-0 file:bg-accent file:px-lg file:py-sm file:text-xs file:font-semibold file:text-on-accent"
          />
        </span>

        <span className="flex flex-col gap-sm">
          <label htmlFor="periodo-fatura" className="text-[11px] font-medium">
            Mês de vencimento
          </label>
          <input
            id="periodo-fatura"
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm"
          />
        </span>
      </div>

      {/* Popup de senha: aparece só quando o PDF realmente exige. */}
      {precisaSenha ? (
        <div className="mt-lg rounded-control border border-amber-500/40 bg-amber-500/10 p-lg">
          <p className="flex items-center gap-md text-xs font-semibold text-amber-100">
            <Lock className="size-4" aria-hidden="true" />
            Esta fatura está protegida por senha
          </p>
          <p className="mt-sm text-[11px] leading-relaxed text-muted-foreground">
            A senha é usada só para abrir o arquivo neste navegador e não é guardada
            em lugar nenhum.
          </p>
          <div className="mt-md flex flex-wrap items-end gap-md">
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && arquivo) void ler(arquivo, senha);
              }}
              placeholder="Senha do PDF"
              autoComplete="off"
              className="rounded-control border border-border bg-background px-lg py-md text-sm"
            />
            <button
              type="button"
              onClick={() => arquivo && void ler(arquivo, senha)}
              disabled={!arquivo || !senha || lendo}
              className="inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {lendo ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Abrir fatura
            </button>
          </div>
        </div>
      ) : null}

      {lendo && !precisaSenha ? (
        <p className="mt-lg flex items-center gap-md text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Lendo o PDF…
        </p>
      ) : null}

      {erro ? (
        <p
          role="alert"
          className="mt-lg flex items-start gap-md rounded-control border border-destructive/40 bg-destructive/10 p-lg text-xs text-neg"
        >
          <TriangleAlert className="mt-xs size-4 shrink-0" aria-hidden="true" />
          {erro}
        </p>
      ) : null}

      {okMsg ? (
        <p
          role="status"
          className="mt-lg flex items-center gap-md rounded-control border border-accent/40 bg-accent/10 p-lg text-xs text-pos"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {okMsg}
        </p>
      ) : null}

      {linhas && linhas.length > 0 ? (
        <div className="mt-xl">
          <div className="mb-lg flex flex-wrap items-baseline justify-between gap-md">
            <h3 className="text-sm font-semibold">
              Confira antes de importar
              <span className="ml-md font-normal text-muted-foreground">
                {linhas.filter((l) => l.incluir).length} de {linhas.length}
              </span>
            </h3>
            <span className="font-mono tabular text-sm">
              {formatBRL(totalSelecionado)}
            </span>
          </div>

          {comParcelas > 0 ? (
            <p className="mb-lg rounded-control border border-secondary/40 bg-secondary/10 p-lg text-xs leading-relaxed">
              <strong>{comParcelas}</strong>{" "}
              {comParcelas === 1 ? "compra parcelada" : "compras parceladas"}{" "}
              {comParcelas === 1 ? "detectada" : "detectadas"}. As parcelas que ainda
              faltam entram automaticamente nos meses seguintes — as que já foram
              cobradas não, porque já estão nas faturas anteriores.
            </p>
          ) : null}

          {ignoradas.length > 0 ? (
            <details className="mb-lg rounded-control border border-border bg-muted/40 p-lg">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {ignoradas.length} linha{ignoradas.length === 1 ? "" : "s"} que não
                consegui interpretar — clique para conferir se perdi alguma compra
              </summary>
              <ul className="mt-md flex flex-col gap-xs">
                {ignoradas.slice(0, 30).map((l, i) => (
                  <li key={i} className="font-mono text-[11px] text-muted-foreground">
                    {l}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-md font-medium">Incluir</th>
                  <th scope="col" className="py-md font-medium">Data</th>
                  <th scope="col" className="py-md font-medium">Descrição</th>
                  <th scope="col" className="py-md font-medium">Categoria</th>
                  <th scope="col" className="py-md text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const restantes = parcelasRestantes(l);
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-md">
                        <input
                          type="checkbox"
                          checked={l.incluir}
                          onChange={(e) =>
                            setLinhas((prev) =>
                              prev
                                ? prev.map((x, xi) =>
                                    xi === i ? { ...x, incluir: e.target.checked } : x,
                                  )
                                : prev,
                            )
                          }
                          aria-label={`Incluir ${l.description}`}
                          className="size-4 cursor-pointer accent-[var(--color-accent)]"
                        />
                      </td>
                      <td className="py-md font-mono tabular text-muted-foreground">
                        {formatDay(l.date)}
                      </td>
                      <td className="py-md">
                        <span className="block">{l.description}</span>
                        {l.installmentTotal ? (
                          <span className="text-[11px] text-secondary">
                            parcela {l.installmentNo}/{l.installmentTotal}
                            {restantes > 0
                              ? ` · ${restantes} restante${restantes === 1 ? "" : "s"} até ${formatDay(
                                  addMonthsToDate(l.date, restantes),
                                )}`
                              : " · última"}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-md">
                        <select
                          value={l.categoryId}
                          onChange={(e) =>
                            setLinhas((prev) =>
                              prev
                                ? prev.map((x, xi) =>
                                    xi === i ? { ...x, categoryId: e.target.value } : x,
                                  )
                                : prev,
                            )
                          }
                          aria-label={`Categoria de ${l.description}`}
                          className="cursor-pointer rounded-control border border-border bg-muted px-md py-sm text-xs"
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-md text-right font-mono tabular">
                        {formatBRL(l.amountCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-xl flex flex-wrap gap-lg">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="inline-flex cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Importar {linhas.filter((l) => l.incluir).length}
            </button>
            <button
              type="button"
              onClick={() => setLinhas(null)}
              className="inline-flex cursor-pointer items-center gap-md rounded-control border border-border px-xl py-md text-sm font-semibold transition-colors duration-200 hover:bg-muted"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Descartar
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

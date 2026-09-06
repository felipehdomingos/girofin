"use client";

import { useMemo, useState } from "react";
import { Check, Landmark, Search, X } from "lucide-react";

import type { Bank } from "@/lib/banks";

/**
 * Escolha do banco a partir da lista oficial do Banco Central.
 *
 * Busca filtrada em vez de um <select> com 400 itens: rolar até "Itaú" numa
 * lista alfabética de 476 instituições é pior que digitar "ita".
 *
 * A lista chega inteira do servidor e filtra no cliente. São ~400 objetos
 * pequenos — ida ao servidor a cada tecla daria latência sem ganho nenhum.
 */
export function BankPicker({
  banks,
  onSelect,
  selected,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  banks: Bank[];
  onSelect: (bank: Bank | null) => void;
  selected: Bank | null;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return banks.slice(0, 12);
    return banks
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.fullName.toLowerCase().includes(q) ||
          String(b.code ?? "").includes(q),
      )
      .slice(0, 30);
  }, [banks, query]);

  if (selected) {
    return (
      <div className="flex items-center gap-lg rounded-control border border-border bg-muted px-lg py-md">
        <BankLogo bank={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{selected.fullName}</span>
          <span className="text-[11px] text-muted-foreground">
            {selected.code ? `código ${selected.code} · ` : ""}
            ISPB {selected.ispb}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
          aria-label="Trocar de banco"
          className="cursor-pointer rounded-control p-sm text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-md rounded-control border border-border bg-muted px-lg">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id="bank"
          type="text"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder="Buscar banco (nome ou código)"
          className="w-full bg-transparent py-md text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {aberto ? (
        <ul className="mt-sm max-h-64 overflow-y-auto rounded-control border border-border bg-card">
          {filtrados.length === 0 ? (
            <li className="px-lg py-md text-xs text-muted-foreground">
              Nenhum banco encontrado. Você pode cadastrar sem escolher banco.
            </li>
          ) : (
            filtrados.map((b) => (
              <li key={b.ispb}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(b);
                    setAberto(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-lg border-b border-border px-lg py-md text-left transition-colors duration-200 last:border-0 hover:bg-muted"
                >
                  <BankLogo bank={b} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{b.fullName}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {b.code ? `código ${b.code}` : "sem código COMPE"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Nome curto e legível para usar como apelido.
 *
 * A razão social do Banco Central não serve como apelido: "NU PAGAMENTOS -
 * INSTITUIÇÃO DE PAGAMENTO" e "ITAÚ UNIBANCO S.A." são nomes de contrato, não
 * de uso diário. Pior: como o apelido é único, preencher conta e cartão do
 * mesmo banco com a mesma razão social fazia o segundo cadastro falhar.
 *
 * `prefixo` distingue os dois ("Itaú Unibanco" x "Cartão Itaú Unibanco"), que é
 * o que evita a colisão logo na origem.
 */
export function shortBankName(fullName: string, prefixo = ""): string {
  const limpo = fullName
    .replace(
      /\s*-?\s*(INSTITUI[ÇC][ÃA]O DE PAGAMENTO|SOCIEDADE DE CR[ÉE]DITO.*|CR[ÉE]DITO,? FINANCIAMENTO.*|CORRETORA DE T[ÍI]TULOS.*|DISTRIBUIDORA DE T[ÍI]TULOS.*|BANCO M[ÚU]LTIPLO|IP)\s*$/i,
      "",
    )
    .replace(/\s*(S\.?\s?A\.?|S\/A|LTDA\.?|ME|EIRELI)\s*$/i, "")
    .replace(/^BCO\s+/i, "Banco ")
    .replace(/\s+/g, " ")
    .trim();

  // Razão social vem toda em maiúscula na base do BCB; Title Case fica legível.
  const titulo = limpo
    .toLowerCase()
    .split(" ")
    .map((p) =>
      p.length <= 2 && !/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(" ");

  return (prefixo ? `${prefixo} ` : "") + titulo;
}

/**
 * Logo do banco, com as iniciais como reserva.
 *
 * Nem todas as 476 instituições têm logo no CDN, e o CDN pode estar fora do ar.
 * `onError` troca para as iniciais em vez de deixar o ícone quebrado do
 * navegador — que é feio e não informa nada.
 */
export function BankLogo({
  bank,
  size = 32,
}: {
  bank: { name: string; logoUrl: string | null };
  size?: number;
}) {
  const [falhou, setFalhou] = useState(false);

  if (!bank.logoUrl || falhou) {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <Landmark className="size-4" />
      </span>
    );
  }

  return (
    // <img> comum e não next/image: são SVGs de CDN externo, e o otimizador de
    // imagem do Next não traria ganho nenhum para vetor.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={bank.logoUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setFalhou(true)}
      className="shrink-0 rounded-control bg-white object-contain p-xs"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Cores como AMOSTRAS VISÍVEIS, não como código hexadecimal num select.
 *
 * O select anterior mostrava "Cor 1 (#3987e5)" — ninguém sabe que cor é essa
 * sem colar num conversor. Cor se escolhe vendo a cor.
 */
export function ColorPicker({
  name,
  value,
  onChange,
  palette,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  name: string;
  value: string;
  onChange: (hex: string) => void;
  palette: readonly string[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div
        role="radiogroup"
        aria-label="Cor"
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        className="flex flex-wrap gap-md"
      >
        {palette.map((hex, i) => {
          const ativa = hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={ativa}
              aria-label={`Cor ${i + 1}`}
              onClick={() => onChange(hex)}
              className={`flex size-11 cursor-pointer items-center justify-center rounded-full transition-transform duration-200 ${
                ativa ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : ""
              }`}
              style={{ backgroundColor: hex }}
            >
              {ativa ? (
                <Check className="size-4 text-black" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

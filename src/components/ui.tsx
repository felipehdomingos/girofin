import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { formatBRL } from "@/lib/money";

/**
 * Peças visuais compartilhadas. Todas seguem MASTER.md: superfície de vidro,
 * transição de 200ms, foco visível, e nenhum hex escrito à mão.
 */

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`glass p-2xl ${className}`}>{children}</Tag>;
}

export function CardTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-xl flex items-baseline justify-between gap-lg">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * Valor monetário. Mono + tabular-nums para alinhar dígitos, e sinal explícito
 * quando é entrada/saída — a cor sozinha não pode carregar a informação.
 */
export function Money({
  cents,
  tone = "neutral",
  size = "md",
  showSign = false,
}: {
  cents: number;
  tone?: "neutral" | "positive" | "negative" | "auto";
  size?: "sm" | "md" | "lg" | "xl";
  showSign?: boolean;
}) {
  const resolved =
    tone === "auto" ? (cents >= 0 ? "positive" : "negative") : tone;

  const toneClass =
    resolved === "positive"
      ? "text-pos"
      : resolved === "negative"
        ? "text-neg"
        : "text-foreground";

  // O "xl" é 2xl e não 3xl de propósito: em mono, "R$ 607.893,57" a 30px mede
  // ~234px e estoura o card de ~215px do grid de 3 colunas. A 24px cabe, e
  // ainda sobra folga para valores de 7 dígitos.
  const sizeClass = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-xl font-semibold",
    xl: "text-2xl font-semibold tracking-tight",
  }[size];

  const sign = showSign ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : "";

  return (
    <span className={`font-mono tabular ${toneClass} ${sizeClass}`}>
      {sign}
      {formatBRL(Math.abs(cents))}
    </span>
  );
}

export function StatCard({
  label,
  cents,
  tone = "neutral",
  hint,
  direction,
}: {
  label: string;
  cents: number;
  tone?: "neutral" | "positive" | "negative" | "auto";
  hint?: string;
  direction?: "in" | "out";
}) {
  return (
    <Card as="div" className="flex flex-col gap-md">
      <div className="flex items-center gap-sm">
        {/* Ícone reforça entrada/saída além da cor. */}
        {direction === "in" ? (
          <ArrowUpRight className="size-4 text-pos" aria-hidden="true" />
        ) : direction === "out" ? (
          <ArrowDownRight className="size-4 text-neg" aria-hidden="true" />
        ) : null}
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <Money cents={cents} tone={tone} size="xl" showSign={tone === "auto"} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "info";
}) {
  const toneClass = {
    neutral: "bg-muted text-muted-foreground",
    positive: "bg-accent/20 text-pos",
    negative: "bg-destructive/20 text-neg",
    warning: "bg-amber-500/20 text-amber-300",
    info: "bg-secondary/20 text-secondary",
  }[tone];

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-md py-xs text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

/** Ponto colorido da categoria. Decorativo: o nome sempre vem ao lado. */
export function CategoryDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Barra de progresso acessível. `now/max` em vez de só a largura visual, para
 * o leitor de tela anunciar o valor em vez de "imagem".
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = "neutral",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "neutral" | "positive" | "warning" | "negative";
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barClass = {
    neutral: "bg-secondary",
    positive: "bg-accent",
    warning: "bg-amber-400",
    negative: "bg-destructive",
  }[tone];

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${barClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-border px-xl py-3xl text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? (
        <p className="mx-auto mt-md max-w-sm text-xs leading-relaxed text-muted-foreground">
          {children}
        </p>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-2xl flex flex-wrap items-start justify-between gap-lg">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-xs text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}

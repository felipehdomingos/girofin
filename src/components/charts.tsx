"use client";

import { useId, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_INK } from "@/lib/palette";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { formatMonth } from "@/lib/dates";

/**
 * Gráficos. Regras que valem para todos, vindas da skill de dataviz:
 *
 * - Toda identidade tem DOIS canais. Cor nunca sozinha: barra tem rótulo direto
 *   no eixo, linha tem legenda + traço distinto. Quem não distingue as cores
 *   continua lendo o gráfico.
 * - Todo gráfico tem tabela equivalente, alternável por botão. É o fallback de
 *   acessibilidade e também o jeito de ver o valor exato sem passar o mouse.
 * - Eixo único, sempre. Dois eixos Y no mesmo gráfico é o erro nº 1 de
 *   visualização: sugere correlação que a escolha de escala inventou.
 * - Grade e eixo recessivos; o dado é que tem contraste.
 * - ANIMAÇÃO DESLIGADA em todas as marcas (`isAnimationActive={false}`).
 *   Não é preferência estética: com a animação ligada, barras e linhas ficaram
 *   renderizando com comprimento zero — rótulo, eixo e ponto apareciam, a
 *   geometria não. Fora o bug, animar a entrada de um gráfico financeiro só
 *   atrasa a leitura do número, e o app respeita prefers-reduced-motion.
 */

// ------------------------------------------------------------------ chrome

const AXIS_TICK = { fill: CHART_INK.axis, fontSize: 11 };

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-control border border-border bg-[#0f172a] px-lg py-md text-xs shadow-lg">
      {children}
    </div>
  );
}

function ChartFrame({
  title,
  hint,
  children,
  table,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  table: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const regionId = useId();

  return (
    <section className="glass p-2xl">
      <div className="mb-xl flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint ? (
            <p className="mt-xs text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={regionId}
          className="cursor-pointer rounded-control border border-border px-lg py-sm text-xs text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
        >
          {showTable ? "Ver gráfico" : "Ver tabela"}
        </button>
      </div>

      <div id={regionId}>{showTable ? table : children}</div>
    </section>
  );
}

function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: Array<Array<string | ReactNode>>;
  caption: string;
}) {
  return (
    // overflow-x-auto: tabela larga rola dentro do próprio container em vez de
    // empurrar a página inteira para o lado no celular.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`py-md font-medium ${i > 0 ? "text-right" : ""}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-md ${ci > 0 ? "text-right font-mono tabular" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------- gastos por categoria

export interface CategoryDatum {
  name: string;
  cents: number;
  color: string;
  share: number;
}

/**
 * Barra HORIZONTAL ordenada do maior para o menor.
 *
 * Horizontal e não vertical porque nome de categoria é texto longo ("Contas e
 * serviços"): no eixo X ele viraria rótulo inclinado ou truncado. Ordenada
 * porque a pergunta é "quem é o maior?", e ordenar responde antes de ler.
 *
 * Nada de pizza: comparar ângulo é comprovadamente pior que comparar
 * comprimento, e com mais de 5 fatias vira decoração.
 */
export function CategoryBarChart({ data }: { data: CategoryDatum[] }) {
  const sorted = [...data].sort((a, b) => b.cents - a.cents);

  return (
    <ChartFrame
      title="Gastos por categoria"
      hint="Ordenado do maior para o menor"
      table={
        <DataTable
          caption="Gastos por categoria no mês"
          columns={["Categoria", "Valor", "% do total"]}
          rows={sorted.map((d) => [d.name, formatBRL(d.cents), `${d.share.toFixed(1)}%`])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 38)}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          barCategoryGap={6}
        >
          <CartesianGrid
            horizontal={false}
            stroke={CHART_INK.grid}
            strokeDasharray="3 3"
          />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickFormatter={(v: number) => formatBRLCompact(v)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_TICK}
            width={110}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CategoryDatum;
              return (
                <TooltipBox>
                  <p className="font-medium">{d.name}</p>
                  <p className="mt-xs font-mono tabular">{formatBRL(d.cents)}</p>
                  <p className="text-muted-foreground">
                    {d.share.toFixed(1)}% das saídas
                  </p>
                </TooltipBox>
              );
            }}
          />
          {/* radius só na ponta do dado: a base fica ancorada na linha zero,
              que é o que permite comparar comprimentos honestamente. */}
          <Bar dataKey="cents" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {sorted.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ------------------------------------------------------ evolução mensal

export interface MonthlyDatum {
  month: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
}

/**
 * Linha: os dados têm eixo temporal e a pergunta é a TENDÊNCIA.
 * Entrada e despesa na mesma escala (as duas são reais em BRL) — por isso
 * cabem num eixo só, sem o truque do eixo duplo.
 */
export function MonthlyTrendChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <TrendChart
      titulo="Evolução mensal"
      dica="Entradas e saídas nos últimos meses"
      data={data.map((d) => ({ ...d, label: formatMonth(d.month) }))}
    />
  );
}

/**
 * Linha de tendência com rótulos já prontos.
 *
 * Separado do MonthlyTrendChart porque o relatório agrupa por DIA em períodos
 * curtos e por MÊS em períodos longos — o gráfico não pode presumir que a
 * chave do eixo é um mês.
 */
export function TrendChart({
  titulo,
  dica,
  data,
}: {
  titulo: string;
  dica: string;
  data: Array<{
    label: string;
    incomeCents: number;
    expenseCents: number;
    balanceCents: number;
  }>;
}) {
  const shaped = data;

  return (
    <ChartFrame
      title={titulo}
      hint={dica}
      table={
        <DataTable
          caption="Entradas, saídas e saldo por período"
          columns={["Período", "Entradas", "Saídas", "Saldo"]}
          rows={shaped.map((d) => [
            d.label,
            formatBRL(d.incomeCents),
            formatBRL(d.expenseCents),
            formatBRL(d.balanceCents),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={shaped} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={(v: number) => formatBRLCompact(v)}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ stroke: CHART_INK.axis, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as MonthlyDatum & { label: string };
              return (
                <TooltipBox>
                  <p className="font-medium">{label}</p>
                  <p className="mt-xs">
                    Entradas:{" "}
                    <span className="font-mono tabular text-pos">
                      {formatBRL(d.incomeCents)}
                    </span>
                  </p>
                  <p>
                    Saídas:{" "}
                    <span className="font-mono tabular text-neg">
                      {formatBRL(d.expenseCents)}
                    </span>
                  </p>
                  <p className="mt-xs border-t border-border pt-xs">
                    Saldo:{" "}
                    <span className="font-mono tabular">{formatBRL(d.balanceCents)}</span>
                  </p>
                </TooltipBox>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: CHART_INK.label }}
            iconType="plainline"
          />
          {/* Traço sólido x tracejado: as duas séries continuam separáveis
              impressas em preto e branco ou por quem não distingue as cores. */}
          <Line
            type="monotone"
            dataKey="incomeCents"
            name="Entradas"
            stroke={CHART_INK.income}
            strokeWidth={2}
            isAnimationActive={false}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="expenseCents"
            name="Saídas"
            stroke={CHART_INK.expense}
            strokeWidth={2}
            strokeDasharray="5 4"
            isAnimationActive={false}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// --------------------------------------------------- projeção de patrimônio

export interface ProjectionDatum {
  month: number;
  investedCents: number;
  balanceCents: number;
  realBalanceCents: number;
}

/**
 * Área: a mensagem é o ACÚMULO ao longo do tempo, e a distância entre
 * "depositado" e "patrimônio" é exatamente o juro composto — a área entre as
 * curvas É o argumento do gráfico.
 */
export function ProjectionChart({
  data,
  showReal,
}: {
  data: ProjectionDatum[];
  showReal: boolean;
}) {
  // Um ponto por mês em 30 anos seriam 360 rótulos ilegíveis; anualiza acima
  // de 5 anos e mantém a granularidade mensal nos prazos curtos.
  const step = data.length > 60 ? 12 : data.length > 24 ? 3 : 1;
  const shaped = data
    .filter((d) => d.month % step === 0)
    .map((d) => ({
      ...d,
      label: d.month === 0 ? "hoje" : `${Math.round(d.month / 12)}a`,
    }));

  return (
    <ChartFrame
      title="Projeção do patrimônio"
      hint={
        showReal
          ? "Nominal x poder de compra de hoje (descontado o IPCA)"
          : "Valor nominal"
      }
      table={
        <DataTable
          caption="Projeção do patrimônio ao longo do tempo"
          columns={
            showReal
              ? ["Momento", "Depositado", "Patrimônio", "Em valor de hoje"]
              : ["Momento", "Depositado", "Patrimônio"]
          }
          rows={shaped.map((d) =>
            showReal
              ? [
                  d.label,
                  formatBRL(d.investedCents),
                  formatBRL(d.balanceCents),
                  formatBRL(d.realBalanceCents),
                ]
              : [d.label, formatBRL(d.investedCents), formatBRL(d.balanceCents)],
          )}
        />
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={shaped} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fillNominal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_INK.nominal} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_INK.nominal} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_INK.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={(v: number) => formatBRLCompact(v)}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ stroke: CHART_INK.axis, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ProjectionDatum & { label: string };
              const juros = d.balanceCents - d.investedCents;
              return (
                <TooltipBox>
                  <p className="font-medium">{label}</p>
                  <p className="mt-xs">
                    Patrimônio:{" "}
                    <span className="font-mono tabular">{formatBRL(d.balanceCents)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Depositado:{" "}
                    <span className="font-mono tabular">{formatBRL(d.investedCents)}</span>
                  </p>
                  <p className="text-pos">
                    Juros:{" "}
                    <span className="font-mono tabular">{formatBRL(juros)}</span>
                  </p>
                  {showReal ? (
                    <p className="mt-xs border-t border-border pt-xs text-muted-foreground">
                      Poder de compra de hoje:{" "}
                      <span className="font-mono tabular">
                        {formatBRL(d.realBalanceCents)}
                      </span>
                    </p>
                  ) : null}
                </TooltipBox>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: CHART_INK.label }} />
          <Area
            type="monotone"
            dataKey="balanceCents"
            name="Patrimônio"
            stroke={CHART_INK.nominal}
            strokeWidth={2}
            fill="url(#fillNominal)"
            isAnimationActive={false}
          />
          {showReal ? (
            <Area
              type="monotone"
              dataKey="realBalanceCents"
              name="Em valor de hoje"
              stroke={CHART_INK.real}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
            />
          ) : null}
          {/* Referência recessiva: é a linha de base contra a qual se lê o
              ganho, não uma terceira série disputando atenção. */}
          <Area
            type="monotone"
            dataKey="investedCents"
            name="Depositado"
            stroke={CHART_INK.invested}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            fill="none"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

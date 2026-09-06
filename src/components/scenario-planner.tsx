"use client";

import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";

import { ProjectionChart } from "./charts";
import { Card, CardTitle, Money } from "./ui";
import { project, realRate } from "@/lib/finance";
import { formatBRL, parseBRLToCents, safePercent } from "@/lib/money";
import type { RateSource } from "@/lib/types";

/**
 * Simulador. Roda inteiro no cliente: a matemática é barata e o feedback tem
 * que ser imediato — mexer no aporte e esperar round-trip mataria a utilidade
 * de comparar cenários.
 *
 * Os cenários não são salvos no banco de propósito: aqui a pergunta é "e se?",
 * e persistir cada tentativa criaria lixo. O que merece persistência é a META,
 * que fica na página Economizar.
 */
export function ScenarioPlanner({
  cdiPct,
  selicPct,
  poupancaPct,
  ipcaPct,
  suggestedMonthlyCents,
}: {
  cdiPct: number;
  selicPct: number;
  poupancaPct: number;
  ipcaPct: number;
  suggestedMonthlyCents: number;
}) {
  const [initial, setInitial] = useState("0");
  const [monthly, setMonthly] = useState(
    suggestedMonthlyCents > 0
      ? (suggestedMonthlyCents / 100).toFixed(2).replace(".", ",")
      : "500,00",
  );
  const [years, setYears] = useState(10);
  const [source, setSource] = useState<RateSource>("CDI");
  const [percentOfIndex, setPercentOfIndex] = useState(100);
  const [customRate, setCustomRate] = useState(12);
  const [showReal, setShowReal] = useState(true);

  const indexPct =
    source === "CDI"
      ? cdiPct
      : source === "SELIC"
        ? selicPct
        : source === "POUPANCA"
          ? poupancaPct
          : customRate;

  // Poupança não rende "X% da poupança" — é taxa fechada. Aplicar o
  // multiplicador ali produziria um número que não existe no mundo real.
  const annualPct =
    source === "CUSTOM" || source === "POUPANCA"
      ? indexPct
      : (indexPct * percentOfIndex) / 100;

  const result = useMemo(() => {
    const initialCents = parseBRLToCents(initial) ?? 0;
    const monthlyCents = parseBRLToCents(monthly) ?? 0;
    return project({
      initialCents,
      monthlyCents,
      months: years * 12,
      annualPct,
      inflationPct: ipcaPct,
    });
  }, [initial, monthly, years, annualPct, ipcaPct]);

  const taxaReal = realRate(annualPct, ipcaPct);
  const percentJuros = safePercent(result.interestCents, result.finalCents);

  return (
    <div className="grid gap-xl lg:grid-cols-[1fr_1.6fr]">
      <Card>
        <CardTitle>Simular</CardTitle>

        <div className="flex flex-col gap-xl">
          <label className="flex flex-col gap-sm">
            <span className="text-xs font-medium">Já tenho hoje</span>
            <input
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              inputMode="decimal"
              className="rounded-control border border-border bg-muted px-lg py-md font-mono text-sm"
            />
          </label>

          <label className="flex flex-col gap-sm">
            <span className="text-xs font-medium">Vou guardar por mês</span>
            <input
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              inputMode="decimal"
              className="rounded-control border border-border bg-muted px-lg py-md font-mono text-sm"
            />
            {suggestedMonthlyCents > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setMonthly((suggestedMonthlyCents / 100).toFixed(2).replace(".", ","))
                }
                className="mt-xs inline-flex cursor-pointer items-center gap-sm self-start text-[11px] text-secondary underline-offset-4 hover:underline"
              >
                <Wallet className="size-3" aria-hidden="true" />
                usar minha sobra média ({formatBRL(suggestedMonthlyCents)})
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Lance alguns meses de gastos e o app sugere aqui a sua sobra real.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-sm">
            <span className="flex items-baseline justify-between text-xs font-medium">
              Por quanto tempo
              <span className="font-mono tabular text-muted-foreground">
                {years} {years === 1 ? "ano" : "anos"}
              </span>
            </span>
            <input
              type="range"
              min={1}
              max={40}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              className="cursor-pointer accent-[var(--color-accent)]"
            />
          </label>

          <label className="flex flex-col gap-sm">
            <span className="text-xs font-medium">Rendimento</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as RateSource)}
              className="cursor-pointer rounded-control border border-border bg-muted px-lg py-md text-sm"
            >
              <option value="CDI">CDI ({cdiPct.toFixed(2).replace(".", ",")}% a.a.)</option>
              <option value="SELIC">
                Selic ({selicPct.toFixed(2).replace(".", ",")}% a.a.)
              </option>
              <option value="POUPANCA">
                Poupança ({poupancaPct.toFixed(2).replace(".", ",")}% a.a.)
              </option>
              <option value="CUSTOM">Taxa que eu definir</option>
            </select>
          </label>

          {source === "CDI" || source === "SELIC" ? (
            <label className="flex flex-col gap-sm">
              <span className="flex items-baseline justify-between text-xs font-medium">
                Percentual do índice
                <span className="font-mono tabular text-muted-foreground">
                  {percentOfIndex}%
                </span>
              </span>
              <input
                type="range"
                min={70}
                max={150}
                value={percentOfIndex}
                onChange={(e) => setPercentOfIndex(Number(e.target.value))}
                className="cursor-pointer accent-[var(--color-accent)]"
              />
              <span className="text-[11px] text-muted-foreground">
                CDB costuma pagar 95–115% do CDI. Tesouro Selic fica perto de 100%.
              </span>
            </label>
          ) : null}

          {source === "CUSTOM" ? (
            <label className="flex flex-col gap-sm">
              <span className="flex items-baseline justify-between text-xs font-medium">
                Taxa anual
                <span className="font-mono tabular text-muted-foreground">
                  {customRate.toFixed(1).replace(".", ",")}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={30}
                step={0.5}
                value={customRate}
                onChange={(e) => setCustomRate(Number(e.target.value))}
                className="cursor-pointer accent-[var(--color-accent)]"
              />
            </label>
          ) : null}

          <label className="flex cursor-pointer items-center gap-md text-xs">
            <input
              type="checkbox"
              checked={showReal}
              onChange={(e) => setShowReal(e.target.checked)}
              className="size-4 cursor-pointer accent-[var(--color-accent)]"
            />
            Mostrar em poder de compra de hoje
          </label>
        </div>
      </Card>

      <div className="flex flex-col gap-xl">
        <div className="grid gap-xl sm:grid-cols-3">
          <Card as="div">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Em {years} {years === 1 ? "ano" : "anos"}
            </p>
            <p className="mt-md">
              <Money cents={result.finalCents} size="xl" tone="positive" />
            </p>
            {showReal ? (
              <p className="mt-xs text-[11px] text-muted-foreground">
                {formatBRL(result.finalRealCents)} em valor de hoje
              </p>
            ) : null}
          </Card>

          <Card as="div">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Você depositou
            </p>
            <p className="mt-md">
              <Money cents={result.investedCents} size="lg" />
            </p>
          </Card>

          <Card as="div">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Juros ganhos
            </p>
            <p className="mt-md">
              <Money cents={result.interestCents} size="lg" tone="positive" />
            </p>
            <p className="mt-xs text-[11px] text-muted-foreground">
              {percentJuros.toFixed(0)}% do total final
            </p>
          </Card>
        </div>

        <ProjectionChart data={result.points} showReal={showReal} />

        <Card as="div">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Rendimento aplicado:{" "}
            <span className="font-mono tabular text-foreground">
              {annualPct.toFixed(2).replace(".", ",")}% a.a.
            </span>{" "}
            (
            <span className="font-mono tabular">
              {(result.monthlyRate * 100).toFixed(3).replace(".", ",")}% a.m.
            </span>
            ). Descontando o IPCA de {ipcaPct.toFixed(2).replace(".", ",")}%, o ganho
            real é{" "}
            <span
              className={`font-mono tabular ${taxaReal >= 0 ? "text-pos" : "text-neg"}`}
            >
              {taxaReal.toFixed(2).replace(".", ",")}% a.a.
            </span>
            {taxaReal < 0
              ? " — abaixo da inflação: esse dinheiro perde poder de compra."
              : "."}{" "}
            Projeção não considera imposto de renda nem taxa de custódia.
          </p>
        </Card>
      </div>
    </div>
  );
}

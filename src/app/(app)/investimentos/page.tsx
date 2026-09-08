import { Info } from "lucide-react";

import { ScenarioPlanner } from "@/components/scenario-planner";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { getRates, poupancaAnnualPct } from "@/lib/bcb";
import { currentMonth } from "@/lib/dates";
import { getAverageSurplus } from "@/lib/repo";
import { requirePageUser } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

/**
 * Projeção de investimentos com as taxas reais do Banco Central.
 *
 * O aporte sugerido vem da SOBRA MÉDIA dos últimos meses fechados, não de um
 * número inventado: a projeção só serve para decidir se refletir dinheiro que
 * de fato sobra. É aqui que o módulo de gastos alimenta o de investimento.
 */
export default async function InvestimentosPage() {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const rates = await getRates();
  const month = currentMonth();
  const averageSurplus = getAverageSurplus(month, 3);

  const poupanca = poupancaAnnualPct(rates.selic.annualPct);

  // Uma taxa desatualizada apresentada como atual, numa ferramenta de decisão
  // financeira, é pior que nenhuma taxa. A origem sempre aparece na tela.
  const anyStale =
    rates.cdi.source !== "api" ||
    rates.selic.source !== "api" ||
    rates.ipca.source !== "api";
  const anyFallback =
    rates.cdi.source === "fallback" ||
    rates.selic.source === "fallback" ||
    rates.ipca.source === "fallback";

  return (
    <>
      <PageHeader
        title="Investimentos"
        subtitle="Quanto o seu dinheiro vira, com as taxas de hoje"
      />

      <Card>
        <CardTitle
          hint={
            anyFallback
              ? "estimativa — API do BCB indisponível"
              : anyStale
                ? "do cache local"
                : "ao vivo, Banco Central"
          }
        >
          Taxas de referência
        </CardTitle>

        <dl className="grid gap-xl sm:grid-cols-4">
          <RateItem
            label="CDI"
            value={rates.cdi.annualPct}
            note="usado na maioria dos títulos de renda fixa"
          />
          <RateItem
            label="Selic"
            value={rates.selic.annualPct}
            note="meta definida pelo Copom"
          />
          <RateItem
            label="Poupança"
            value={poupanca}
            note="regra vigente, TR considerada zero"
          />
          <RateItem
            label="IPCA (12m)"
            value={rates.ipca.annualPct}
            note="inflação acumulada — o que corrói o ganho"
          />
        </dl>

        {anyFallback ? (
          <p className="mt-xl flex items-start gap-md rounded-control border border-amber-500/40 bg-amber-500/10 p-lg text-xs text-amber-200">
            <Info className="mt-xs size-4 shrink-0" aria-hidden="true" />
            Não consegui falar com a API do Banco Central e não havia dado em cache.
            Os números acima são estimativas — trate a projeção como ordem de grandeza,
            não como precisão.
          </p>
        ) : null}
      </Card>

      <div className="mt-xl">
        <ScenarioPlanner
          cdiPct={rates.cdi.annualPct}
          selicPct={rates.selic.annualPct}
          poupancaPct={poupanca}
          ipcaPct={rates.ipca.annualPct}
          suggestedMonthlyCents={Math.max(averageSurplus, 0)}
        />
      </div>
    </>
  );
}

function RateItem({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-sm font-mono tabular text-xl font-semibold">
        {value.toFixed(2).replace(".", ",")}%
        <span className="ml-xs text-xs font-normal text-muted-foreground">a.a.</span>
      </dd>
      <p className="mt-xs text-[11px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

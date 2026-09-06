import "server-only";

import { formatBRL, safePercent } from "./money";
import { opportunityCost, monthsToReach } from "./finance";
import { KIND_TARGET } from "./types";
import type { BillInMonth, CategoryKind, MonthSummary } from "./types";

/**
 * Motor de recomendação: transforma os números do mês em orientação acionável.
 *
 * Duas regras de projeto que valem mais que o conteúdo de qualquer conselho:
 *
 * 1. Todo conselho carrega um NÚMERO e uma AÇÃO. "Cuidado com gastos" não muda
 *    comportamento; "corte R$ 180/mês em Restaurantes e isso vira R$ 15.400 em
 *    5 anos" muda. Por isso quase todo conselho traz `monthlySavingCents`.
 * 2. Nada de conselho sem dado. Com o mês vazio, o motor devolve orientação de
 *    primeiro uso, não um diagnóstico inventado sobre lugar nenhum.
 */

export type AdviceSeverity = "critical" | "warning" | "info" | "success";

export interface Advice {
  id: string;
  severity: AdviceSeverity;
  title: string;
  /** Explicação em uma ou duas frases. Sem jargão. */
  body: string;
  /** O passo concreto. */
  action?: string;
  /** Economia mensal estimada, quando o conselho tem um número. */
  monthlySavingCents?: number;
  /** O que essa economia vira investida em 5 anos. */
  fiveYearCents?: number;
}

interface AdviceInput {
  summary: MonthSummary;
  previous: MonthSummary | null;
  bills: BillInMonth[];
  recurringMonthlyCents: number;
  annualRatePct: number;
  hasEmergencyFund: boolean;
  emergencyFundCents: number;
}

export function buildAdvice(input: AdviceInput): Advice[] {
  const {
    summary,
    previous,
    bills,
    recurringMonthlyCents,
    annualRatePct,
    hasEmergencyFund,
    emergencyFundCents,
  } = input;

  const advice: Advice[] = [];
  const { incomeCents, expenseCents, balanceCents, byKind } = summary;

  // Sem dado suficiente, orienta o primeiro passo em vez de diagnosticar o vazio.
  if (summary.transactionCount === 0) {
    return [
      {
        id: "empty",
        severity: "info",
        title: "Comece lançando os gastos de hoje",
        body:
          "Ainda não há lançamentos neste mês. O diagnóstico aparece assim que " +
          "houver o que analisar — some uns 7 dias de gastos e a leitura já fica útil.",
        action: "Use o campo de lançamento rápido: escreva 'mercado 152,30' e enter.",
      },
    ];
  }

  // ---------------------------------------------------------------- vencidas
  const overdue = bills.filter((b) => b.status === "OVERDUE");
  if (overdue.length > 0) {
    const total = overdue.reduce((acc, b) => acc + b.bill.amountCents, 0);
    advice.push({
      id: "overdue-bills",
      severity: "critical",
      title:
        overdue.length === 1
          ? `${overdue[0].bill.name} está vencida`
          : `${overdue.length} contas vencidas`,
      body:
        `Somam ${formatBRL(total)}. Juros e multa de atraso são o gasto mais caro ` +
        `e mais evitável do orçamento — nenhum investimento compensa pagar multa.`,
      action: "Quite hoje e revise a data de vencimento para o dia seguinte ao salário.",
    });
  }

  // ------------------------------------------------------------ mês negativo
  if (balanceCents < 0) {
    advice.push({
      id: "negative-balance",
      severity: "critical",
      title: "Você gastou mais do que recebeu",
      body:
        `Saída de ${formatBRL(expenseCents)} contra entrada de ${formatBRL(incomeCents)}. ` +
        `O rombo de ${formatBRL(Math.abs(balanceCents))} saiu de algum lugar: reserva, ` +
        `limite ou fatura do mês que vem.`,
      action: "Ataque as duas maiores categorias de 'Desejo' abaixo antes de qualquer outra coisa.",
    });
  }

  // -------------------------------------------------------------- 50/30/20
  if (incomeCents > 0) {
    const pct = (kind: CategoryKind) => safePercent(byKind[kind], incomeCents);
    const needPct = pct("NEED");
    const wantPct = pct("WANT");
    const savePct = pct("SAVE");

    if (wantPct > KIND_TARGET.WANT + 5) {
      const excessCents = Math.round(
        byKind.WANT - (incomeCents * KIND_TARGET.WANT) / 100,
      );
      advice.push({
        id: "want-over",
        severity: "warning",
        title: `Desejos consumiram ${wantPct.toFixed(0)}% da sua renda`,
        body:
          `A referência 50/30/20 sugere até ${KIND_TARGET.WANT}%. O excedente é ` +
          `${formatBRL(excessCents)} — é dinheiro que existe e está indo para o lugar errado, ` +
          `não dinheiro que falta.`,
        action: "Escolha UMA categoria de desejo para cortar pela metade neste mês.",
        monthlySavingCents: excessCents,
        fiveYearCents: opportunityCost(excessCents, annualRatePct),
      });
    }

    if (savePct < KIND_TARGET.SAVE && balanceCents > 0) {
      const targetCents = Math.round((incomeCents * KIND_TARGET.SAVE) / 100);
      const gapCents = targetCents - byKind.SAVE;
      // Só sugere o que cabe na sobra real: meta que não cabe no orçamento
      // vira frustração, não hábito.
      const feasible = Math.min(gapCents, balanceCents);
      if (feasible > 0) {
        advice.push({
          id: "save-under",
          severity: "warning",
          title: `Você guardou ${savePct.toFixed(0)}% — a meta é ${KIND_TARGET.SAVE}%`,
          body:
            `Faltam ${formatBRL(gapCents)} para a meta, e sobraram ${formatBRL(balanceCents)} ` +
            `no mês. Dá para guardar ${formatBRL(feasible)} agora, sem cortar nada.`,
          action: "Transfira no dia do salário, não no fim do mês. O que sobra por último nunca sobra.",
          monthlySavingCents: feasible,
          fiveYearCents: opportunityCost(feasible, annualRatePct),
        });
      }
    }

    if (needPct > KIND_TARGET.NEED + 10) {
      advice.push({
        id: "need-over",
        severity: "info",
        title: `Custo fixo alto: ${needPct.toFixed(0)}% da renda em essenciais`,
        body:
          `Acima de ${KIND_TARGET.NEED}% o orçamento fica sem folga para imprevisto. ` +
          `Custo fixo não se corta com força de vontade — se corta renegociando ou trocando.`,
        action: "Renegocie as 3 maiores: aluguel, plano de saúde e telefonia costumam ter margem.",
      });
    }

    if (savePct >= KIND_TARGET.SAVE) {
      advice.push({
        id: "save-ok",
        severity: "success",
        title: `${savePct.toFixed(0)}% da renda guardada`,
        body: "Está no alvo da regra 50/30/20. O hábito está funcionando — mantenha o automático ligado.",
      });
    }
  }

  // --------------------------------------------------- estouro de orçamento
  const overBudget = summary.byCategory
    .filter((c) => c.budgetUsedPct !== null && c.budgetUsedPct > 100)
    .sort((a, b) => (b.budgetUsedPct ?? 0) - (a.budgetUsedPct ?? 0));

  for (const cat of overBudget.slice(0, 3)) {
    const overCents = cat.totalCents - (cat.budgetCents ?? 0);
    advice.push({
      id: `budget-${cat.category.id}`,
      severity: "warning",
      title: `${cat.category.name} estourou o orçamento em ${formatBRL(overCents)}`,
      body:
        `Gasto de ${formatBRL(cat.totalCents)} contra um teto de ` +
        `${formatBRL(cat.budgetCents ?? 0)} (${(cat.budgetUsedPct ?? 0).toFixed(0)}% usado).`,
      action:
        overCents > 0
          ? `Reduza ${formatBRL(overCents)} no próximo mês ou suba o teto — um teto que você estoura todo mês não é teto.`
          : undefined,
      monthlySavingCents: overCents,
      fiveYearCents: opportunityCost(overCents, annualRatePct),
    });
  }

  // ------------------------------------------------- variação mês a mês
  if (previous && previous.transactionCount > 0) {
    const prevByCat = new Map(
      previous.byCategory.map((c) => [c.category.id, c.totalCents]),
    );

    const jumps = summary.byCategory
      .map((c) => {
        const before = prevByCat.get(c.category.id) ?? 0;
        return { cat: c, before, delta: c.totalCents - before };
      })
      // Filtro duplo de relevância: precisa ser aumento grande em VALOR
      // (> R$ 100) e em PROPORÇÃO (> 30%). Só percentual daria alarme falso
      // em categoria de R$ 20; só valor absoluto ignoraria o contexto.
      .filter((j) => j.before > 0 && j.delta > 10_000 && j.delta / j.before > 0.3)
      .sort((a, b) => b.delta - a.delta);

    for (const jump of jumps.slice(0, 2)) {
      const pctUp = safePercent(jump.delta, jump.before);
      advice.push({
        id: `jump-${jump.cat.category.id}`,
        severity: "warning",
        title: `${jump.cat.category.name} subiu ${pctUp.toFixed(0)}% em relação ao mês passado`,
        body:
          `Passou de ${formatBRL(jump.before)} para ${formatBRL(jump.cat.totalCents)}. ` +
          `Se foi pontual, tudo bem. Se virou hábito, são ${formatBRL(jump.delta)} a mais todo mês.`,
        action: "Abra os lançamentos da categoria e confirme se foi evento único.",
        monthlySavingCents: jump.delta,
        fiveYearCents: opportunityCost(jump.delta, annualRatePct),
      });
    }
  }

  // ----------------------------------------------------------- recorrentes
  if (recurringMonthlyCents > 0) {
    const yearly = recurringMonthlyCents * 12;
    advice.push({
      id: "recurring",
      severity: "info",
      title: `${formatBRL(recurringMonthlyCents)}/mês em gastos recorrentes`,
      body:
        `São ${formatBRL(yearly)} por ano em débito automático — o tipo de gasto que ` +
        `passa despercebido justamente por ser previsível. Investido a ` +
        `${annualRatePct.toFixed(1)}% a.a., isso seria ` +
        `${formatBRL(opportunityCost(recurringMonthlyCents, annualRatePct))} em 5 anos.`,
      action: "Revise a lista de recorrentes e cancele o que você não usou nos últimos 30 dias.",
    });
  }

  // -------------------------------------------------- reserva de emergência
  if (!hasEmergencyFund && expenseCents > 0) {
    const targetCents = expenseCents * 6;
    const monthly = balanceCents > 0 ? balanceCents : Math.round(expenseCents * 0.1);
    const months = monthsToReach({
      initialCents: emergencyFundCents,
      monthlyCents: monthly,
      targetCents,
      annualPct: annualRatePct,
    });

    advice.push({
      id: "emergency-fund",
      severity: "warning",
      title: "Sua reserva de emergência ainda não cobre 6 meses",
      body:
        `Seu custo mensal é ${formatBRL(expenseCents)}, então a reserva alvo é ` +
        `${formatBRL(targetCents)}. Você tem ${formatBRL(emergencyFundCents)}. ` +
        (months !== null
          ? `Guardando ${formatBRL(monthly)} por mês, chega lá em ${months} ${months === 1 ? "mês" : "meses"}.`
          : `Com o aporte atual não dá para chegar — é preciso liberar sobra antes.`),
      action: "Reserva vem antes de investimento de risco. É ela que evita virar dívida no imprevisto.",
    });
  }

  // Ordem = urgência. Crítico primeiro; dentro do mesmo nível, o de maior
  // economia primeiro, porque é o que mais muda o resultado.
  const rank: Record<AdviceSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    success: 3,
  };
  return advice.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return (b.monthlySavingCents ?? 0) - (a.monthlySavingCents ?? 0);
  });
}

/** Soma do que dá para economizar somando os conselhos com número. */
export function totalPotentialSaving(advice: Advice[]): number {
  return advice
    .filter((a) => a.severity !== "success")
    .reduce((acc, a) => acc + (a.monthlySavingCents ?? 0), 0);
}

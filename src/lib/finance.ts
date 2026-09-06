/**
 * Matemática financeira da projeção.
 *
 * Tudo em centavos inteiros na entrada e na saída. Internamente o cálculo usa
 * float (juros composto exige potência fracionária), mas cada ponto da série é
 * arredondado de volta para centavo — o erro não se acumula de mês para mês.
 */

/**
 * Taxa anual -> taxa mensal EQUIVALENTE.
 *
 * `(1+i)^(1/12) - 1`, não `i/12`. A divisão simples é o erro clássico: 12% a.a.
 * dividido por 12 dá 1% a.m., que capitalizado 12 vezes vira 12,68% a.a. —
 * projeção 0,68 ponto otimista todo ano, e o desvio cresce com o prazo.
 */
export function annualToMonthly(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/**
 * Taxa real: desconta a inflação do rendimento nominal.
 * `(1+nominal)/(1+inflação) - 1` — subtrair direto (nominal - ipca) superestima,
 * e a diferença aparece justamente nos prazos longos, onde a decisão importa.
 */
export function realRate(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

export interface ProjectionPoint {
  month: number;
  /** Só o que você depositou, sem rendimento. */
  investedCents: number;
  /** Patrimônio nominal (o número que aparece no extrato). */
  balanceCents: number;
  /** Patrimônio em poder de compra de hoje, descontado o IPCA. */
  realBalanceCents: number;
  /** balance - invested. O quanto o juro trabalhou por você. */
  interestCents: number;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  finalCents: number;
  finalRealCents: number;
  investedCents: number;
  interestCents: number;
  monthlyRate: number;
  annualPct: number;
}

/**
 * Projeta aporte inicial + aportes mensais.
 * Convenção: o aporte do mês entra ANTES de render (postecipado no início do
 * período). É o comportamento de quem investe no dia do salário.
 */
export function project(input: {
  initialCents: number;
  monthlyCents: number;
  months: number;
  annualPct: number;
  inflationPct: number;
}): ProjectionResult {
  const { initialCents, monthlyCents, months, annualPct, inflationPct } = input;

  const r = annualToMonthly(annualPct);
  const inflationMonthly = annualToMonthly(inflationPct);

  const points: ProjectionPoint[] = [];
  let balance = initialCents;
  let invested = initialCents;

  points.push({
    month: 0,
    investedCents: invested,
    balanceCents: Math.round(balance),
    realBalanceCents: Math.round(balance),
    interestCents: 0,
  });

  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + r) + monthlyCents;
    invested += monthlyCents;

    // Deflaciona pelo acumulado da inflação até o mês m.
    const deflator = Math.pow(1 + inflationMonthly, m);

    points.push({
      month: m,
      investedCents: invested,
      balanceCents: Math.round(balance),
      realBalanceCents: Math.round(balance / deflator),
      interestCents: Math.round(balance) - invested,
    });
  }

  const last = points[points.length - 1];
  return {
    points,
    finalCents: last.balanceCents,
    finalRealCents: last.realBalanceCents,
    investedCents: last.investedCents,
    interestCents: last.interestCents,
    monthlyRate: r,
    annualPct,
  };
}

/**
 * Quantos meses até juntar `targetCents`.
 * Retorna null quando é inalcançável (sem aporte e sem saldo, ou alvo já batido
 * seria 0). Itera em vez de resolver o logaritmo porque o caso `r = 0` quebraria
 * a fórmula fechada e o laço trata os dois casos com o mesmo código.
 */
export function monthsToReach(input: {
  initialCents: number;
  monthlyCents: number;
  targetCents: number;
  annualPct: number;
  maxMonths?: number;
}): number | null {
  const { initialCents, monthlyCents, targetCents, annualPct } = input;
  const maxMonths = input.maxMonths ?? 12 * 60; // teto de 60 anos

  if (initialCents >= targetCents) return 0;
  if (monthlyCents <= 0 && annualPct <= 0) return null;

  const r = annualToMonthly(annualPct);
  let balance = initialCents;

  for (let m = 1; m <= maxMonths; m++) {
    balance = balance * (1 + r) + monthlyCents;
    if (balance >= targetCents) return m;
  }
  return null;
}

/**
 * Quanto guardar por mês para chegar em `targetCents` no prazo dado.
 * PMT = (FV - PV*(1+r)^n) / (((1+r)^n - 1)/r)
 */
export function requiredMonthly(input: {
  initialCents: number;
  targetCents: number;
  months: number;
  annualPct: number;
}): number {
  const { initialCents, targetCents, months, annualPct } = input;
  if (months <= 0) return 0;

  const r = annualToMonthly(annualPct);
  const growth = Math.pow(1 + r, months);
  const futureOfInitial = initialCents * growth;
  const remaining = targetCents - futureOfInitial;

  if (remaining <= 0) return 0; // o aporte inicial sozinho já chega lá

  // r = 0 tornaria o denominador 0/0; nesse caso é divisão simples.
  const factor = r === 0 ? months : (growth - 1) / r;
  return Math.round(remaining / factor);
}

/**
 * O custo real de um gasto recorrente: o que ele viraria se fosse investido.
 * É o número que muda comportamento — "R$ 39,90 de streaming" não impressiona;
 * "R$ 3.400 em 5 anos" impressiona.
 */
export function opportunityCost(
  monthlyCents: number,
  annualPct: number,
  years = 5,
): number {
  return project({
    initialCents: 0,
    monthlyCents,
    months: years * 12,
    annualPct,
    inflationPct: 0,
  }).finalCents;
}

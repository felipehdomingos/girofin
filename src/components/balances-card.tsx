import Link from "next/link";
import { CreditCard, Landmark, PiggyBank, TrendingUp, Wallet } from "lucide-react";

import { Card, CardTitle, EmptyState, Money, ProgressBar } from "./ui";
import { formatBRL, safePercent } from "@/lib/money";
import type { AccountKind, AccountWithBalance } from "@/lib/types";

const KIND_ICON: Record<AccountKind, typeof Wallet> = {
  CORRENTE: Landmark,
  POUPANCA: PiggyBank,
  CARTEIRA: Wallet,
  INVESTIMENTO: TrendingUp,
  CARTAO: CreditCard,
};

/**
 * Quanto você tem e quanto você deve, na tela inicial.
 *
 * Faltava justamente isso: o Resumo mostrava só o FLUXO do mês (entrou, saiu,
 * sobrou) e nunca o SALDO das contas. Quem estava no cheque especial não via
 * dívida nenhuma na home, porque a home não olhava para saldo.
 *
 * Disponível e dívida ficam em blocos separados de propósito. Somar os dois num
 * "patrimônio líquido" esconderia a informação que muda decisão: dá para
 * ter R$ 3.000 na conta e R$ 4.000 de fatura, e o número único diria −1.000 sem
 * deixar claro que existe uma conta a pagar chegando.
 */
export function BalancesCard({ accounts }: { accounts: AccountWithBalance[] }) {
  const contas = accounts.filter((a) => a.kind !== "CARTAO");
  const cartoes = accounts.filter((a) => a.kind === "CARTAO");

  // Só o que é positivo entra em "disponível": conta no cheque especial não é
  // dinheiro que você tem, é dívida — e aparece do outro lado.
  const disponivelCents = contas
    .filter((a) => a.balanceCents > 0)
    .reduce((acc, a) => acc + a.balanceCents, 0);

  const especialCents = contas
    .filter((a) => a.balanceCents < 0)
    .reduce((acc, a) => acc - a.balanceCents, 0);

  const faturasCents = cartoes.reduce((acc, a) => acc + Math.abs(a.balanceCents), 0);
  const dividaCents = especialCents + faturasCents;

  if (accounts.length === 0) {
    return (
      <Card>
        <CardTitle>Onde está o seu dinheiro</CardTitle>
        <EmptyState title="Nenhuma conta cadastrada">
          Cadastre suas contas e cartões para ver aqui quanto você tem e quanto deve.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle
        hint={
          <Link
            href="/configuracoes"
            className="cursor-pointer underline underline-offset-4"
          >
            gerenciar
          </Link>
        }
      >
        Onde está o seu dinheiro
      </CardTitle>

      <div className="mb-xl grid gap-lg sm:grid-cols-2">
        <div className="rounded-control border border-border bg-muted/40 p-lg">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Disponível
          </p>
          <p className="mt-sm">
            <Money cents={disponivelCents} size="lg" tone="positive" />
          </p>
          <p className="mt-xs text-[11px] text-muted-foreground">
            Somando só as contas no positivo
          </p>
        </div>

        <div
          className={`rounded-control border p-lg ${
            dividaCents > 0
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-muted/40"
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Você deve
          </p>
          <p className="mt-sm">
            <Money
              cents={dividaCents}
              size="lg"
              tone={dividaCents > 0 ? "negative" : "neutral"}
            />
          </p>
          <p className="mt-xs text-[11px] text-muted-foreground">
            {dividaCents === 0
              ? "Nenhuma dívida em aberto"
              : [
                  faturasCents > 0 ? `${formatBRL(faturasCents)} em faturas` : null,
                  especialCents > 0
                    ? `${formatBRL(especialCents)} no cheque especial`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
      </div>

      <ul className="flex flex-col">
        {accounts.map((a) => {
          const Icon = KIND_ICON[a.kind];
          const ehCartao = a.kind === "CARTAO";
          const devedor = a.balanceCents < 0;
          const usado = Math.abs(a.balanceCents);

          // Cartão mede contra o limite de crédito; conta mede contra o cheque
          // especial. Nos dois casos, é "quanto do crédito já foi consumido".
          const teto = ehCartao ? a.creditLimitCents : a.overdraftLimitCents;
          const pct =
            teto && usado > 0 && (ehCartao || devedor)
              ? safePercent(usado, teto)
              : null;

          return (
            <li key={a.id} className="border-b border-border py-lg last:border-0">
              <div className="flex flex-wrap items-center gap-lg">
                {a.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="size-8 shrink-0 rounded-control bg-white object-contain p-xs"
                  />
                ) : (
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-control"
                    style={{ backgroundColor: `${a.color}22` }}
                  >
                    <Icon
                      className="size-4"
                      style={{ color: a.color }}
                      aria-hidden="true"
                    />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-md">
                    <span className="truncate text-sm">{a.name}</span>
                    {a.last4 ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        •••• {a.last4}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ehCartao
                      ? a.closingDay && a.dueDay
                        ? `fecha dia ${a.closingDay} · vence dia ${a.dueDay}`
                        : "cartão de crédito"
                      : devedor
                        ? "usando o cheque especial"
                        : "disponível"}
                  </span>
                </span>

                <span className="text-right">
                  <Money
                    cents={ehCartao ? usado : a.balanceCents}
                    size="md"
                    tone={ehCartao || devedor ? "negative" : "auto"}
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    {ehCartao
                      ? "fatura em aberto"
                      : devedor
                        ? "saldo devedor"
                        : "saldo"}
                  </span>
                </span>
              </div>

              {pct !== null ? (
                <div className="mt-md">
                  <ProgressBar
                    value={usado}
                    max={teto ?? 1}
                    label={`${a.name}: ${pct.toFixed(0)}% do limite usado`}
                    tone={pct > 80 ? "negative" : pct > 50 ? "warning" : "positive"}
                  />
                  <p className="mt-xs text-[11px] text-muted-foreground">
                    {formatBRL(usado)} de {formatBRL(teto ?? 0)} ({pct.toFixed(0)}%)
                    {ehCartao ? " do limite" : " do cheque especial"} ·{" "}
                    {formatBRL(Math.max((teto ?? 0) - usado, 0))} livre
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

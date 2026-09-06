"use client";

import { useState } from "react";
import {
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  Trash2,
} from "lucide-react";

import { ActionButton } from "./action-button";
import { BankLogo, BankPicker, ColorPicker } from "./bank-picker";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { Badge, Card, CardTitle, EmptyState, Money } from "./ui";
import {
  createAccountForm,
  createIncomeSourceForm,
  deleteAccountAction,
  deleteIncomeSourceAction,
} from "@/lib/actions";
import type { Bank } from "@/lib/banks";
import { VIZ_PALETTE } from "@/lib/palette";
import {
  ACCOUNT_KIND_LABEL,
  INCOME_KIND_LABEL,
  type AccountKind,
  type AccountWithBalance,
  type IncomeSource,
  type IncomeSourceTotal,
} from "@/lib/types";

const KIND_ICON: Record<AccountKind, typeof Wallet> = {
  CORRENTE: Landmark,
  POUPANCA: PiggyBank,
  CARTEIRA: Wallet,
  INVESTIMENTO: TrendingUp,
  CARTAO: CreditCard,
};

/**
 * Cadastro de bancos/cartões e de empresas (fontes de renda).
 *
 * O saldo de cada carteira é sempre CALCULADO: saldo inicial + entradas −
 * saídas. Nunca guardado numa coluna. Um saldo gravado divergiria do extrato na
 * primeira exclusão de lançamento, e não haveria como saber qual dos dois
 * está certo.
 */
export function AccountManager({
  accounts,
  banks,
  incomeSources,
  incomeThisMonth,
  nextAccountColor,
  nextSourceColor,
  show = "all",
}: {
  accounts: AccountWithBalance[];
  banks: Bank[];
  incomeSources: IncomeSource[];
  incomeThisMonth: IncomeSourceTotal[];
  nextAccountColor: string;
  nextSourceColor: string;
  /** Qual bloco renderizar — as abas de Configurações mostram um de cada vez. */
  show?: "all" | "bancos" | "empresas";
}) {
  if (show === "empresas") {
    return (
      <SecaoEmpresas
        incomeSources={incomeSources}
        incomeThisMonth={incomeThisMonth}
        nextSourceColor={nextSourceColor}
      />
    );
  }

  if (show === "bancos") {
    return (
      <SecaoBancos
        accounts={accounts}
        banks={banks}
        nextAccountColor={nextAccountColor}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2xl">
      <SecaoBancos
        accounts={accounts}
        banks={banks}
        nextAccountColor={nextAccountColor}
      />
      <SecaoEmpresas
        incomeSources={incomeSources}
        incomeThisMonth={incomeThisMonth}
        nextSourceColor={nextSourceColor}
      />
    </div>
  );
}

// ------------------------------------------------------------------ bancos

function SecaoBancos({
  accounts,
  banks,
  nextAccountColor,
}: {
  accounts: AccountWithBalance[];
  banks: Bank[];
  nextAccountColor: string;
}) {
  const [kind, setKind] = useState<AccountKind>("CORRENTE");
  const [bank, setBank] = useState<Bank | null>(null);
  const [color, setColor] = useState(nextAccountColor);
  const [nome, setNome] = useState("");

  const totalCents = accounts
    // Cartão é dívida, não patrimônio: somá-lo ao saldo das contas inflaria o
    // total. Fatura em aberto aparece separada, com sinal negativo.
    .filter((a) => a.kind !== "CARTAO")
    .reduce((acc, a) => acc + a.balanceCents, 0);

  const cardDebtCents = accounts
    .filter((a) => a.kind === "CARTAO")
    .reduce((acc, a) => acc + a.balanceCents, 0);

  return (
    <div className="grid gap-xl lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardTitle hint={`${accounts.length} cadastrados`}>
          Bancos, cartões e carteiras
        </CardTitle>

        {accounts.length === 0 ? (
          <EmptyState title="Nada cadastrado ainda">
            Cadastre suas contas e cartões ao lado. Depois disso, cada lançamento
            pode dizer de onde o dinheiro saiu — e o saldo de cada um se atualiza
            sozinho.
          </EmptyState>
        ) : (
          <>
            <div className="mb-xl grid gap-lg sm:grid-cols-2">
              <div className="rounded-control border border-border bg-muted/40 p-lg">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total disponível
                </p>
                <p className="mt-sm">
                  <Money cents={totalCents} size="lg" tone="auto" />
                </p>
                <p className="mt-xs text-[11px] text-muted-foreground">
                  Sem contar cartão de crédito
                </p>
              </div>
              {cardDebtCents !== 0 ? (
                <div className="rounded-control border border-border bg-muted/40 p-lg">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Faturas em aberto
                  </p>
                  <p className="mt-sm">
                    <Money cents={Math.abs(cardDebtCents)} size="lg" tone="negative" />
                  </p>
                  <p className="mt-xs text-[11px] text-muted-foreground">
                    Já lançado, ainda não pago
                  </p>
                </div>
              ) : null}
            </div>

            <ul className="flex flex-col">
              {accounts.map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-lg border-b border-border py-lg last:border-0"
                  >
                    {/* Logo real do banco quando existe; ícone do tipo de
                        conta quando não. */}
                    {a.logoUrl ? (
                      <BankLogo bank={{ name: a.name, logoUrl: a.logoUrl }} />
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
                        {ACCOUNT_KIND_LABEL[a.kind]}
                        {a.kind === "CARTAO" && a.closingDay && a.dueDay
                          ? ` · fecha dia ${a.closingDay}, vence dia ${a.dueDay}`
                          : ""}
                      </span>
                    </span>

                    <span className="text-right">
                      <Money
                        cents={a.balanceCents}
                        size="md"
                        tone={a.kind === "CARTAO" ? "negative" : "auto"}
                      />
                      <span className="block text-[11px] text-muted-foreground">
                        no mês: +{(a.monthInCents / 100).toFixed(0)} / −
                        {(a.monthOutCents / 100).toFixed(0)}
                      </span>
                    </span>

                    <ActionButton
                      action={() => deleteAccountAction(a.id)}
                      confirm
                      confirmLabel="Excluir?"
                      ariaLabel={`Excluir ${a.name}`}
                      className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </ActionButton>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Cadastrar banco ou cartão</CardTitle>

        <ActionForm action={createAccountForm} submitLabel="Cadastrar">
          {(state) => (
            <>
              {/* Campos escondidos: o que o BankPicker escolheu vai junto no
                  submit sem o usuário ter que digitar nada disso. */}
              <input type="hidden" name="bankIspb" value={bank?.ispb ?? ""} />
              <input type="hidden" name="bankName" value={bank?.fullName ?? ""} />
              <input type="hidden" name="logoUrl" value={bank?.logoUrl ?? ""} />

              <Field
                label="Banco"
                name="bank"
                hint="Lista oficial do Banco Central. Opcional — dá para cadastrar dinheiro em espécie sem banco."
              >
                <BankPicker
                  banks={banks}
                  selected={bank}
                  onSelect={(b) => {
                    setBank(b);
                    // Pré-preenche o apelido com o nome do banco: na maioria
                    // dos casos é exatamente isso que a pessoa ia digitar.
                    if (b && !nome.trim()) setNome(b.fullName);
                  }}
                />
              </Field>

              <Field
                label={kind === "CARTAO" ? "Apelido do cartão" : "Apelido da conta"}
                name="name"
                required
                error={fieldError(state, "name")}
                hint="Como você chama no dia a dia. É esse nome que aparece nos lançamentos."
              >
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={40}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={kind === "CARTAO" ? "Nubank roxinho" : "Itaú corrente"}
                />
              </Field>

              <Field label="Tipo" name="kind" required>
                <Select
                  id="kind"
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AccountKind)}
                  required
                >
                  {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
                    <option key={k} value={k}>
                      {ACCOUNT_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* Fechamento, vencimento e finais só existem em cartão. */}
              {kind === "CARTAO" ? (
                <>
                  <Field
                    label="4 últimos dígitos"
                    name="last4"
                    error={fieldError(state, "last4")}
                    hint="Opcional, para diferenciar dois cartões do mesmo banco. O número completo nunca é pedido nem guardado."
                  >
                    <Input
                      id="last4"
                      name="last4"
                      inputMode="numeric"
                      maxLength={4}
                      pattern="\d{4}"
                      placeholder="1234"
                      className="w-24 font-mono"
                    />
                  </Field>

                  <Field
                    label="Limite do cartão"
                    name="creditLimit"
                    error={fieldError(state, "creditLimit")}
                    hint="Opcional. Com ele o app mostra quanto do limite já foi usado."
                  >
                    <Input
                      id="creditLimit"
                      name="creditLimit"
                      inputMode="decimal"
                      placeholder="5.000,00"
                      className="font-mono"
                    />
                  </Field>

                  <Field
                    label="Dia do fechamento da fatura"
                    name="closingDay"
                    required
                    error={fieldError(state, "closingDay")}
                    hint="Compra feita depois deste dia entra só na fatura seguinte."
                  >
                    <Input
                      id="closingDay"
                      name="closingDay"
                      type="number"
                      min={1}
                      max={31}
                      required
                      defaultValue={25}
                      className="w-24 font-mono"
                    />
                  </Field>

                  <Field
                    label="Dia do vencimento da fatura"
                    name="dueDay"
                    required
                    error={fieldError(state, "dueDay")}
                    hint="É a data em que o dinheiro sai de fato."
                  >
                    <Input
                      id="dueDay"
                      name="dueDay"
                      type="number"
                      min={1}
                      max={31}
                      required
                      defaultValue={5}
                      className="w-24 font-mono"
                    />
                  </Field>
                </>
              ) : null}

              <Field
                label={kind === "CARTAO" ? "Fatura em aberto hoje" : "Saldo atual"}
                name="opening"
                error={fieldError(state, "opening")}
                hint="Aceita negativo (use - na frente)."
              >
                <Input
                  id="opening"
                  name="opening"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="font-mono"
                />
              </Field>

              <Field
                label="Cor"
                name="color"
                error={fieldError(state, "color")}
                hint="Usada nos gráficos. Paleta validada para contraste e daltonismo."
              >
                <ColorPicker
                  name="color"
                  value={color}
                  onChange={setColor}
                  palette={VIZ_PALETTE}
                />
              </Field>
            </>
          )}
        </ActionForm>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- empresas

function SecaoEmpresas({
  incomeSources,
  incomeThisMonth,
  nextSourceColor,
}: {
  incomeSources: IncomeSource[];
  incomeThisMonth: IncomeSourceTotal[];
  nextSourceColor: string;
}) {
  return (
    <div className="grid gap-xl lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardTitle hint="recebido no mês atual">Empresas e fontes de renda</CardTitle>

        {incomeSources.length === 0 ? (
          <EmptyState title="Nenhuma empresa cadastrada">
            Cadastre onde você trabalha. Separar CLT de PJ é o que mostra qual parte
            da sua renda é estável e qual varia.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {incomeSources.map((s) => {
              const total = incomeThisMonth.find((t) => t.source.id === s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-lg border-b border-border py-lg last:border-0"
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {INCOME_KIND_LABEL[s.kind]}
                    </span>
                  </span>
                  <Badge tone={s.kind === "PJ" ? "warning" : "info"}>
                    {INCOME_KIND_LABEL[s.kind]}
                  </Badge>
                  <span className="text-right">
                    <Money cents={total?.totalCents ?? 0} size="md" tone="positive" />
                    {total ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {total.share.toFixed(0)}% da renda
                      </span>
                    ) : null}
                  </span>
                  <ActionButton
                    action={() => deleteIncomeSourceAction(s.id)}
                    confirm
                    confirmLabel="Excluir?"
                    ariaLabel={`Excluir ${s.name}`}
                    className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </ActionButton>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Cadastrar empresa</CardTitle>

        <ActionForm action={createIncomeSourceForm} submitLabel="Cadastrar">
          {(state) => (
            <>
              <Field
                label="Nome da empresa"
                name="name"
                required
                error={fieldError(state, "name")}
              >
                <Input
                  id="src-name"
                  name="name"
                  required
                  maxLength={40}
                  placeholder="Acme Tecnologia"
                />
              </Field>

              <Field
                label="Regime"
                name="kind"
                required
                hint="PJ costuma variar mês a mês — é o que o app usa para calcular sua sobra com cautela."
              >
                <Select id="src-kind" name="kind" defaultValue="PJ" required>
                  <option value="CLT">CLT</option>
                  <option value="PJ">PJ</option>
                  <option value="OUTRO">Outra (freela, aluguel, dividendos)</option>
                </Select>
              </Field>

              <Field label="Cor" name="color" required error={fieldError(state, "color")}>
                <Select
                  id="src-color"
                  name="color"
                  defaultValue={nextSourceColor}
                  required
                >
                  {VIZ_PALETTE.map((hex, i) => (
                    <option key={hex} value={hex}>
                      Cor {i + 1} ({hex})
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </ActionForm>
      </Card>
    </div>
  );
}

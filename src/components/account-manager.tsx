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
import { BankLogo, BankPicker, ColorPicker, shortBankName } from "./bank-picker";
import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { Badge, Card, CardTitle, EmptyState, Money, ProgressBar } from "./ui";
import {
  createAccountForm,
  createIncomeSourceForm,
  deleteAccountAction,
  deleteIncomeSourceAction,
} from "@/lib/actions";
import type { Bank } from "@/lib/banks";
import { formatBRL, safePercent } from "@/lib/money";
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
 * Cadastros de onde o dinheiro está e de onde ele vem.
 *
 * CONTA e CARTÃO são cadastros SEPARADOS de propósito. São objetos diferentes:
 * conta tem saldo (dinheiro que você tem), cartão tem limite e fatura (dinheiro
 * que você deve). Um formulário só, com metade dos campos aparecendo e sumindo
 * conforme o tipo, obrigava o usuário a descobrir qual metade valia para ele.
 *
 * O saldo de cada conta é sempre CALCULADO: saldo inicial + entradas − saídas.
 * Nunca guardado numa coluna. Um saldo gravado divergiria do extrato na
 * primeira exclusão de lançamento, e não haveria como saber qual está certo.
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
  show?: "all" | "contas" | "cartoes" | "empresas";
}) {
  const contas = accounts.filter((a) => a.kind !== "CARTAO");
  const cartoes = accounts.filter((a) => a.kind === "CARTAO");

  if (show === "empresas") {
    return (
      <SecaoEmpresas
        incomeSources={incomeSources}
        incomeThisMonth={incomeThisMonth}
        nextSourceColor={nextSourceColor}
      />
    );
  }

  if (show === "contas") {
    return <SecaoContas contas={contas} banks={banks} nextColor={nextAccountColor} />;
  }

  if (show === "cartoes") {
    return <SecaoCartoes cartoes={cartoes} banks={banks} nextColor={nextAccountColor} />;
  }

  return (
    <div className="flex flex-col gap-2xl">
      <SecaoContas contas={contas} banks={banks} nextColor={nextAccountColor} />
      <SecaoCartoes cartoes={cartoes} banks={banks} nextColor={nextAccountColor} />
      <SecaoEmpresas
        incomeSources={incomeSources}
        incomeThisMonth={incomeThisMonth}
        nextSourceColor={nextSourceColor}
      />
    </div>
  );
}

// ------------------------------------------------------- contas bancárias

function SecaoContas({
  contas,
  banks,
  nextColor,
}: {
  contas: AccountWithBalance[];
  banks: Bank[];
  nextColor: string;
}) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [color, setColor] = useState(nextColor);
  const [nome, setNome] = useState("");
  const [kind, setKind] = useState<Exclude<AccountKind, "CARTAO">>("CORRENTE");

  const totalCents = contas.reduce((acc, a) => acc + a.balanceCents, 0);

  return (
    <div className="grid gap-xl lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardTitle hint={`${contas.length} cadastradas`}>
          Contas — onde o seu dinheiro está
        </CardTitle>

        {contas.length === 0 ? (
          <EmptyState title="Nenhuma conta cadastrada">
            Cadastre ao lado a conta onde cai o seu salário. É o mínimo para
            começar a lançar: todo gasto sai de algum lugar e toda entrada cai em
            algum lugar.
          </EmptyState>
        ) : (
          <>
            <div className="mb-xl rounded-control border border-border bg-muted/40 p-lg">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total disponível
              </p>
              <p className="mt-sm">
                <Money cents={totalCents} size="lg" tone="auto" />
              </p>
              <p className="mt-xs text-[11px] text-muted-foreground">
                Somando todas as contas. Cartão de crédito é dívida e fica na
                outra aba.
              </p>
            </div>

            <ul className="flex flex-col">
              {contas.map((a) => {
                const Icon = KIND_ICON[a.kind];
                // Cheque especial usado NÃO é um campo: é o próprio saldo
                // quando fica negativo. Guardar "quanto usei" separado criaria
                // duas fontes de verdade que divergem no primeiro lançamento.
                const usadoNoEspecial = a.balanceCents < 0 ? -a.balanceCents : 0;
                const pctEspecial =
                  a.overdraftLimitCents && usadoNoEspecial > 0
                    ? safePercent(usadoNoEspecial, a.overdraftLimitCents)
                    : null;

                return (
                  <li key={a.id} className="border-b border-border py-lg last:border-0">
                    <div className="flex flex-wrap items-center gap-lg">
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
                        <span className="block truncate text-sm">{a.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {ACCOUNT_KIND_LABEL[a.kind]}
                          {a.overdraftLimitCents
                            ? ` · cheque especial de ${formatBRL(a.overdraftLimitCents)}`
                            : ""}
                        </span>
                      </span>

                      <span className="text-right">
                        <Money cents={a.balanceCents} size="md" tone="auto" />
                        <span className="block text-[11px] text-muted-foreground">
                          {usadoNoEspecial > 0
                            ? "saldo devedor"
                            : `no mês: +${(a.monthInCents / 100).toFixed(0)} / −${(a.monthOutCents / 100).toFixed(0)}`}
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
                    </div>

                    {pctEspecial !== null ? (
                      <div className="mt-md">
                        <ProgressBar
                          value={usadoNoEspecial}
                          max={a.overdraftLimitCents ?? 1}
                          label={`${a.name}: ${pctEspecial.toFixed(0)}% do cheque especial usado`}
                          tone={pctEspecial > 80 ? "negative" : "warning"}
                        />
                        <p className="mt-xs text-[11px] text-neg">
                          Usando {formatBRL(usadoNoEspecial)} de{" "}
                          {formatBRL(a.overdraftLimitCents ?? 0)} do cheque especial
                          ({pctEspecial.toFixed(0)}%) — é dívida, e das mais caras.
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Nova conta</CardTitle>

        <ActionForm action={createAccountForm} submitLabel="Cadastrar conta">
          {(state) => (
            <>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="bankIspb" value={bank?.ispb ?? ""} />
              <input type="hidden" name="bankName" value={bank?.fullName ?? ""} />
              <input type="hidden" name="logoUrl" value={bank?.logoUrl ?? ""} />

              <Field
                label="Banco"
                name="bank"
                hint="Lista oficial do Banco Central. Deixe em branco para dinheiro em espécie."
              >
                <BankPicker
                  banks={banks}
                  selected={bank}
                  onSelect={(b) => {
                    setBank(b);
                    // Nome curto e legível, nao a razao social do BCB.
                    if (b && !nome.trim()) setNome(shortBankName(b.fullName));
                  }}
                />
              </Field>

              <Field
                label="Apelido"
                name="name"
                required
                error={fieldError(state, "name")}
                hint="É esse nome que aparece na hora de lançar."
              >
                <Input
                  id="acc-name"
                  name="name"
                  required
                  maxLength={40}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Itaú corrente"
                />
              </Field>

              <Field label="Tipo" name="kindVisible" required>
                <Select
                  id="acc-kind"
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as Exclude<AccountKind, "CARTAO">)
                  }
                  required
                >
                  <option value="CORRENTE">Conta corrente</option>
                  <option value="POUPANCA">Poupança</option>
                  <option value="INVESTIMENTO">Investimento</option>
                  <option value="CARTEIRA">Dinheiro em espécie</option>
                </Select>
              </Field>

              <Field
                label="Saldo atual"
                name="opening"
                error={fieldError(state, "opening")}
                hint="Quanto tem hoje. Se estiver no cheque especial, use - na frente (ex: -350,00)."
              >
                <Input
                  id="acc-opening"
                  name="opening"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="font-mono"
                />
              </Field>

              {kind === "CORRENTE" ? (
                <Field
                  label="Limite do cheque especial"
                  name="overdraftLimit"
                  error={fieldError(state, "overdraftLimit")}
                  hint="Opcional. Com ele o app mostra quanto do limite você já consumiu."
                >
                  <Input
                    id="acc-overdraft"
                    name="overdraftLimit"
                    inputMode="decimal"
                    placeholder="2.000,00"
                    className="font-mono"
                  />
                </Field>
              ) : null}

              {kind === "CORRENTE" ? (
                <p className="rounded-control border border-border bg-muted/50 p-lg text-[11px] leading-relaxed text-muted-foreground">
                  O limite do cheque especial <strong>não entra</strong> no seu saldo
                  disponível. É crédito do banco, não dinheiro seu — somar os dois é
                  exatamente o que faz alguém gastar o que não tem. Saldo negativo
                  aparece como dívida, porque é o que ele é.
                </p>
              ) : null}

              <Field
                label="Cor"
                name="color"
                error={fieldError(state, "color")}
                hint="Usada nos gráficos."
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

// -------------------------------------------------- cartões de crédito

function SecaoCartoes({
  cartoes,
  banks,
  nextColor,
}: {
  cartoes: AccountWithBalance[];
  banks: Bank[];
  nextColor: string;
}) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [color, setColor] = useState(nextColor);
  const [nome, setNome] = useState("");

  // Fatura é dívida: o saldo do cartão é negativo, e o valor devido é o módulo.
  const faturaTotal = cartoes.reduce((acc, a) => acc + Math.abs(a.balanceCents), 0);

  return (
    <div className="grid gap-xl lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardTitle hint={`${cartoes.length} cadastrados`}>
          Cartões de crédito — o que você já deve
        </CardTitle>

        {cartoes.length === 0 ? (
          <EmptyState title="Nenhum cartão cadastrado">
            Cadastre ao lado. Com o fechamento e o vencimento da fatura, o app
            joga cada parcela no mês em que ela realmente vai ser cobrada.
          </EmptyState>
        ) : (
          <>
            <div className="mb-xl rounded-control border border-border bg-muted/40 p-lg">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total em faturas
              </p>
              <p className="mt-sm">
                <Money cents={faturaTotal} size="lg" tone="negative" />
              </p>
              <p className="mt-xs text-[11px] text-muted-foreground">
                Já lançado, ainda não pago
              </p>
            </div>

            <ul className="flex flex-col">
              {cartoes.map((c) => {
                const usado = Math.abs(c.balanceCents);
                const pctLimite = c.creditLimitCents
                  ? safePercent(usado, c.creditLimitCents)
                  : null;

                return (
                  <li
                    key={c.id}
                    className="border-b border-border py-lg last:border-0"
                  >
                    <div className="flex flex-wrap items-center gap-lg">
                      {c.logoUrl ? (
                        <BankLogo bank={{ name: c.name, logoUrl: c.logoUrl }} />
                      ) : (
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-control"
                          style={{ backgroundColor: `${c.color}22` }}
                        >
                          <CreditCard
                            className="size-4"
                            style={{ color: c.color }}
                            aria-hidden="true"
                          />
                        </span>
                      )}

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-md">
                          <span className="truncate text-sm">{c.name}</span>
                          {c.last4 ? (
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              •••• {c.last4}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.closingDay && c.dueDay
                            ? `fecha dia ${c.closingDay} · vence dia ${c.dueDay}`
                            : "sem ciclo definido"}
                        </span>
                      </span>

                      <span className="text-right">
                        <Money cents={usado} size="md" tone="negative" />
                        {c.creditLimitCents ? (
                          <span className="block text-[11px] text-muted-foreground">
                            de {formatBRL(c.creditLimitCents)}
                          </span>
                        ) : null}
                      </span>

                      <ActionButton
                        action={() => deleteAccountAction(c.id)}
                        confirm
                        confirmLabel="Excluir?"
                        ariaLabel={`Excluir ${c.name}`}
                        className="rounded-control p-sm text-muted-foreground hover:bg-muted hover:text-neg"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </ActionButton>
                    </div>

                    {pctLimite !== null ? (
                      <div className="mt-md">
                        <ProgressBar
                          value={usado}
                          max={c.creditLimitCents ?? 1}
                          label={`${c.name}: ${pctLimite.toFixed(0)}% do limite usado`}
                          tone={
                            pctLimite > 80
                              ? "negative"
                              : pctLimite > 50
                                ? "warning"
                                : "positive"
                          }
                        />
                        <p className="mt-xs text-[11px] text-muted-foreground">
                          {pctLimite.toFixed(0)}% do limite usado ·{" "}
                          {formatBRL(Math.max((c.creditLimitCents ?? 0) - usado, 0))}{" "}
                          disponível
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Novo cartão</CardTitle>

        <ActionForm action={createAccountForm} submitLabel="Cadastrar cartão">
          {(state) => (
            <>
              {/* Tipo fixo: este formulário só cadastra cartão. */}
              <input type="hidden" name="kind" value="CARTAO" />
              <input type="hidden" name="bankIspb" value={bank?.ispb ?? ""} />
              <input type="hidden" name="bankName" value={bank?.fullName ?? ""} />
              <input type="hidden" name="logoUrl" value={bank?.logoUrl ?? ""} />

              <Field label="Banco emissor" name="bank" hint="Lista oficial do Banco Central.">
                <BankPicker
                  banks={banks}
                  selected={bank}
                  onSelect={(b) => {
                    setBank(b);
                    // Prefixo "Cartao": o apelido e unico, e sem ele o cartao
                    // colidiria com a conta do mesmo banco.
                    if (b && !nome.trim()) setNome(shortBankName(b.fullName, "Cartão"));
                  }}
                />
              </Field>

              <Field
                label="Apelido do cartão"
                name="name"
                required
                error={fieldError(state, "name")}
                hint="Como você chama no dia a dia."
              >
                <Input
                  id="card-name"
                  name="name"
                  required
                  maxLength={40}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nubank roxinho"
                />
              </Field>

              <Field
                label="4 últimos dígitos"
                name="last4"
                error={fieldError(state, "last4")}
                hint="Opcional, para diferenciar dois cartões do mesmo banco. O número completo nunca é pedido."
              >
                <Input
                  id="card-last4"
                  name="last4"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder="1234"
                  className="w-24 font-mono"
                />
              </Field>

              <Field
                label="Limite total"
                name="creditLimit"
                error={fieldError(state, "creditLimit")}
                hint="Opcional. Com ele o app mostra quanto do limite já foi usado."
              >
                <Input
                  id="card-limit"
                  name="creditLimit"
                  inputMode="decimal"
                  placeholder="5.000,00"
                  className="font-mono"
                />
              </Field>

              <div className="grid grid-cols-2 gap-lg">
                <Field
                  label="Fecha dia"
                  name="closingDay"
                  required
                  error={fieldError(state, "closingDay")}
                >
                  <Input
                    id="card-closing"
                    name="closingDay"
                    type="number"
                    min={1}
                    max={31}
                    required
                    defaultValue={25}
                    className="font-mono"
                  />
                </Field>

                <Field
                  label="Vence dia"
                  name="dueDay"
                  required
                  error={fieldError(state, "dueDay")}
                >
                  <Input
                    id="card-due"
                    name="dueDay"
                    type="number"
                    min={1}
                    max={31}
                    required
                    defaultValue={5}
                    className="font-mono"
                  />
                </Field>
              </div>

              <p className="rounded-control border border-border bg-muted/50 p-lg text-[11px] leading-relaxed text-muted-foreground">
                Compra feita <strong>até</strong> o dia do fechamento entra na
                fatura que está fechando. Depois disso, já cai na seguinte — é
                assim que o app sabe em que mês a parcela vai pesar.
              </p>

              <Field
                label="Fatura em aberto hoje"
                name="opening"
                error={fieldError(state, "opening")}
                hint="Quanto já está lançado e ainda não foi pago. Use - na frente."
              >
                <Input
                  id="card-opening"
                  name="opening"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="font-mono"
                />
              </Field>

              <Field label="Cor" name="color" error={fieldError(state, "color")}>
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
  const [cor, setCor] = useState(nextSourceColor);

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

              <Field label="Cor" name="color" error={fieldError(state, "color")}>
                <ColorPicker
                  name="color"
                  value={cor}
                  onChange={setCor}
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

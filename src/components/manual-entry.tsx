"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { createTransactionForm } from "@/lib/actions";
import { formatBRL, parseBRLToCents, splitCents } from "@/lib/money";
import {
  ACCOUNT_KIND_LABEL,
  KIND_LABEL,
  METHOD_ACCOUNT_KINDS,
  METHOD_ACCOUNT_LABEL,
  METHOD_LABEL,
  type Account,
  type Category,
  type IncomeSource,
  type PaymentMethod,
  type TxNature,
} from "@/lib/types";

/**
 * Lançamento detalhado — o caminho para quando o rápido não basta: data
 * diferente de hoje, observação, escolher carteira, marcar parcelamento.
 *
 * O lançamento rápido cobre o dia a dia; este cobre o caso completo. Ter os
 * dois evita o erro clássico de empurrar todo mundo por um formulário longo
 * só porque uma minoria dos casos precisa de todos os campos.
 */
export function ManualEntry({
  categories,
  accounts,
  incomeSources,
  today,
  bare = false,
}: {
  categories: Category[];
  accounts: Account[];
  incomeSources: IncomeSource[];
  today: string;
  /** Dentro do modal, o card e o título vêm do próprio modal. */
  bare?: boolean;
}) {
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [nature, setNature] = useState<TxNature>("VISTA");
  const [installments, setInstallments] = useState(2);
  const [amountMode, setAmountMode] = useState<"TOTAL" | "PARCELA">("TOTAL");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [alsoBill, setAlsoBill] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [data, setData] = useState(today);

  // Compromisso agendado x gasto realizado: a data decide.
  const futuro = data > today;

  const grouped = (["NEED", "WANT", "SAVE"] as const).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const isCard = selectedAccount?.kind === "CARTAO";

  // Só as contas que fazem sentido para a forma de pagamento escolhida.
  const contasCompativeis = method
    ? accounts.filter((a) => METHOD_ACCOUNT_KINDS[method].includes(a.kind))
    : [];

  // Prévia do parcelamento, calculada com a MESMA função que grava no banco —
  // o que você vê aqui é exatamente o que vai para o banco, centavo a centavo.
  const cents = parseBRLToCents(amount);
  const totalCents =
    cents === null
      ? null
      : amountMode === "PARCELA"
        ? cents * installments
        : cents;
  const preview =
    nature === "PARCELADO" && totalCents !== null && installments >= 2
      ? splitCents(totalCents, installments)
      : null;

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper className={bare ? "" : "glass p-2xl"}>
      {bare ? null : (
        <h2 className="mb-lg text-sm font-semibold tracking-tight">
          Lançamento detalhado
        </h2>
      )}

      <ActionForm action={createTransactionForm} submitLabel="Salvar lançamento">
        {(state) => (
          <>
            <Field label="Tipo" name="type" required>
              <Select
                id="type"
                name="type"
                value={type}
                onChange={(e) => {
                  const v = e.target.value as "INCOME" | "EXPENSE";
                  setType(v);
                  // Entrada não se parcela nem é custo fixo.
                  if (v === "INCOME") setNature("VISTA");
                }}
                required
              >
                <option value="EXPENSE">Saída</option>
                <option value="INCOME">Entrada</option>
              </Select>
            </Field>

            {type === "EXPENSE" ? (
              <Field
                label="Forma"
                name="nature"
                required
                hint="Custo fixo entra na conta de gasto recorrente. Parcelado cria uma linha por mês."
              >
                <Select
                  id="nature"
                  name="nature"
                  value={nature}
                  onChange={(e) => setNature(e.target.value as TxNature)}
                  required
                >
                  <option value="VISTA">À vista</option>
                  <option value="FIXO">Custo fixo (todo mês)</option>
                  <option value="PARCELADO">Parcelado</option>
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="nature" value="VISTA" />
            )}

            <Field
              label="Descrição"
              name="description"
              required
              error={fieldError(state, "description")}
              hint="É por aqui que o app aprende a categorizar sozinho depois."
            >
              <Input
                id="description"
                name="description"
                required
                maxLength={120}
                placeholder="Mercado do bairro"
              />
            </Field>

            {nature === "PARCELADO" ? (
              <>
                <Field
                  label="Número de parcelas"
                  name="installments"
                  required
                  error={fieldError(state, "installments")}
                >
                  <Input
                    id="installments"
                    name="installments"
                    type="number"
                    min={2}
                    max={72}
                    required
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                    className="font-mono"
                  />
                </Field>

                <Field
                  label="O valor que vou digitar é"
                  name="amountMode"
                  hint="As duas formas são usadas — escolha a que você tem na mão."
                >
                  <Select
                    id="amountMode"
                    name="amountMode"
                    value={amountMode}
                    onChange={(e) =>
                      setAmountMode(e.target.value as "TOTAL" | "PARCELA")
                    }
                  >
                    <option value="TOTAL">o total da compra</option>
                    <option value="PARCELA">o valor de cada parcela</option>
                  </Select>
                </Field>
              </>
            ) : (
              <input type="hidden" name="amountMode" value="TOTAL" />
            )}

            <Field
              label={
                nature === "PARCELADO" && amountMode === "PARCELA"
                  ? "Valor de cada parcela"
                  : nature === "PARCELADO"
                    ? "Valor total da compra"
                    : "Valor"
              }
              name="amount"
              required
              error={fieldError(state, "amount")}
              hint="Aceita 1.234,56 ou 1234,56."
            >
              <Input
                id="amount"
                name="amount"
                required
                inputMode="decimal"
                placeholder="152,30"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono"
              />
            </Field>

            {preview ? (
              <p className="rounded-control border border-border bg-muted/50 p-lg text-xs leading-relaxed">
                <span className="font-semibold">
                  {installments}x de {formatBRL(preview[0])}
                </span>
                {preview[0] !== preview[preview.length - 1] ? (
                  <>
                    {" "}
                    (as últimas de {formatBRL(preview[preview.length - 1])} — o
                    centavo que sobra da divisão vai nas primeiras)
                  </>
                ) : null}
                <br />
                Total {formatBRL(totalCents ?? 0)}, uma parcela por mês.
              </p>
            ) : null}

            <Field
              label="Data"
              name="date"
              required
              error={fieldError(state, "date")}
              hint={
                isCard
                  ? "Dia da compra. A parcela cai no vencimento da fatura correspondente."
                  : undefined
              }
            >
              <Input
                id="date"
                name="date"
                type="date"
                required
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </Field>

            <Field
              label="Categoria"
              name="categoryId"
              required
              error={fieldError(state, "categoryId")}
            >
              <Select id="categoryId" name="categoryId" required>
                {grouped.map(({ kind, items }) =>
                  items.length ? (
                    <optgroup key={kind} label={KIND_LABEL[kind]}>
                      {items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </Select>
            </Field>

            {/*
              A ponte entre os dois conceitos que se confundem:
              LANÇAMENTO é o que já saiu do bolso; CONTA A PAGAR é o compromisso
              que ainda vai vencer. Lançar a mensalidade da faculdade registra o
              gasto do mês, mas não faz o app lembrar você dela no mês que vem.
              Este checkbox faz as duas coisas de uma vez, no momento exato em
              que a confusão acontece.
            */}
            {nature === "FIXO" ? (
              <div className="rounded-control border border-secondary/40 bg-secondary/5 p-lg">
                <label className="flex cursor-pointer items-start gap-md text-xs">
                  <input
                    type="checkbox"
                    name="alsoBill"
                    checked={alsoBill}
                    onChange={(e) => setAlsoBill(e.target.checked)}
                    className="mt-xs size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                  />
                  <span>
                    <span className="font-semibold">
                      Cadastrar também em Contas a pagar
                    </span>
                    <span className="mt-xs block leading-relaxed text-muted-foreground">
                      Este lançamento registra o gasto de agora. Marcando aqui, a
                      cobrança também passa a aparecer todo mês em “A pagar”, com
                      aviso de vencimento.
                    </span>
                  </span>
                </label>

                {alsoBill ? (
                  <div className="mt-lg flex items-center gap-md">
                    <label htmlFor="billDueDay" className="text-xs">
                      Vence todo dia
                    </label>
                    <Input
                      id="billDueDay"
                      name="billDueDay"
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={10}
                      className="w-20 font-mono"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Data futura: é compromisso, não gasto realizado. O dinheiro não
                saiu de conta nenhuma ainda, então não faz sentido exigir a
                origem — e o lugar natural disso é Contas a pagar. */}
            {futuro ? (
              <p className="rounded-control border border-secondary/40 bg-secondary/10 p-lg text-xs leading-relaxed">
                <span className="font-semibold">Data futura.</span> Isso é um
                compromisso, não um gasto que já aconteceu — então a conta de
                origem fica opcional: você diz de onde saiu na hora de pagar.
                <br />
                Se é um boleto ou conta que vence, cadastrar em{" "}
                <Link
                  href="/contas"
                  className="cursor-pointer underline underline-offset-4"
                >
                  Contas a pagar
                </Link>{" "}
                é melhor: você recebe o aviso de vencimento e marca como paga
                quando pagar.
              </p>
            ) : null}

            {type === "EXPENSE" ? (
              <Field
                label="Forma de pagamento"
                name="method"
                hint={
                  futuro
                    ? "Opcional enquanto a data não chegou."
                    : "Define de onde o dinheiro sai — é o que faz o saldo de cada conta fechar."
                }
              >
                <Select
                  id="method"
                  name="method"
                  value={method}
                  onChange={(e) => {
                    const m = e.target.value as PaymentMethod | "";
                    setMethod(m);
                    // A conta escolhida pode não servir para a nova forma
                    // (um cartão não recebe pix). Limpa em vez de deixar uma
                    // combinação inválida passar despercebida.
                    setAccountId("");
                  }}
                >
                  <option value="">Não informar</option>
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {/* A conta só aparece depois da forma de pagamento, e já filtrada:
                crédito lista só cartões, pix e débito listam só contas
                bancárias, dinheiro lista só carteira. Mostrar todas as contas
                em qualquer forma deixaria passar "pix saindo do cartão", e aí
                nem o saldo da conta nem a fatura do cartão fechariam. */}
            {type === "EXPENSE" && method ? (
              <Field
                label={METHOD_ACCOUNT_LABEL[method]}
                name="accountId"
                required={!futuro}
                hint={
                  isCard && selectedAccount
                    ? `Fecha dia ${selectedAccount.closingDay}, vence dia ${selectedAccount.dueDay} — a parcela cai na fatura correspondente.`
                    : undefined
                }
                error={fieldError(state, "accountId")}
              >
                {contasCompativeis.length === 0 ? (
                  <p className="rounded-control border border-amber-500/40 bg-amber-500/10 p-lg text-xs text-amber-200">
                    Você ainda não cadastrou{" "}
                    {method === "CREDITO"
                      ? "nenhum cartão de crédito"
                      : method === "DINHEIRO"
                        ? "nenhuma carteira de dinheiro"
                        : "nenhuma conta bancária"}
                    . Cadastre em Configurações → Contas e cartões.
                  </p>
                ) : (
                  <Select
                    id="accountId"
                    name="accountId"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required={!futuro}
                  >
                    <option value="">{futuro ? "Definir depois" : "Escolha…"}</option>
                    {contasCompativeis.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.last4 ? ` •••• ${a.last4}` : ""} —{" "}
                        {ACCOUNT_KIND_LABEL[a.kind]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {type === "INCOME" && accounts.length > 0 ? (
              <Field
                label="Entrou em qual conta"
                name="accountId"
                hint="Opcional, mas é o que mantém o saldo da conta correto."
              >
                <Select
                  id="accountId"
                  name="accountId"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Não informar</option>
                  {accounts
                    .filter((a) => a.kind !== "CARTAO")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {ACCOUNT_KIND_LABEL[a.kind]}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}

            {type === "INCOME" && incomeSources.length > 0 ? (
              <Field
                label="Fonte da renda"
                name="incomeSourceId"
                hint="Separar CLT de PJ é o que mostra qual parte da sua renda é estável."
              >
                <Select id="incomeSourceId" name="incomeSourceId">
                  {incomeSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field
              label="Observação"
              name="notes"
              error={fieldError(state, "notes")}
              hint="Opcional."
            >
              <Input id="notes" name="notes" maxLength={500} />
            </Field>
          </>
        )}
      </ActionForm>
    </Wrapper>
  );
}

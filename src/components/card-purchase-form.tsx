"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { ActionForm, Field, Input, Select, fieldError } from "./form-kit";
import { createTransactionForm } from "@/lib/actions";
import { addMonthsToDate, firstInvoiceDueDate, formatMonthLong } from "@/lib/dates";
import { formatBRL, parseBRLToCents, splitCents } from "@/lib/money";
import { KIND_LABEL, type Account, type Category } from "@/lib/types";

/**
 * Lançar compra NO CARTÃO — só isso.
 *
 * A tela de Cartões usava o formulário geral, que pergunta forma de pagamento e
 * conta de origem. Aqui essas duas perguntas já têm resposta: é crédito, e é
 * este cartão. Perguntar de novo é convite para lançar um pix na tela do cartão
 * e depois não entender por que a fatura não fecha.
 *
 * O que ESTE formulário precisa mostrar, e o geral não mostra, é a virada: em
 * qual fatura a compra cai. Com fechamento dia 3, comprar dia 2 é a fatura
 * deste mês e comprar dia 4 é a do mês que vem — a diferença é de trinta dias
 * no bolso, e não dá para adivinhar olhando o formulário.
 */
export function CardPurchaseForm({
  card,
  categories,
  today,
}: {
  card: Account;
  categories: Category[];
  today: string;
}) {
  const [nature, setNature] = useState<"VISTA" | "PARCELADO">("VISTA");
  const [installments, setInstallments] = useState(2);
  const [amountMode, setAmountMode] = useState<"TOTAL" | "PARCELA">("TOTAL");
  const [amount, setAmount] = useState("");
  const [data, setData] = useState(today);

  const grouped = (["NEED", "WANT", "SAVE"] as const).map((kind) => ({
    kind,
    items: categories.filter((c) => c.kind === kind),
  }));

  // Prévia calculada com a MESMA função que grava — o que aparece aqui é
  // exatamente o que vai para o banco, centavo a centavo.
  const cents = parseBRLToCents(amount);
  const totalCents =
    cents === null ? null : amountMode === "PARCELA" ? cents * installments : cents;
  const parcelas =
    nature === "PARCELADO" && totalCents !== null && installments >= 2
      ? splitCents(totalCents, installments)
      : null;

  /*
   * O ciclo só existe se o cartão tiver fechamento e vencimento cadastrados.
   * Sem eles a compra cai na própria data, e é melhor dizer isso do que exibir
   * uma previsão inventada.
   */
  const temCiclo = card.closingDay !== null && card.dueDay !== null;
  const vencimento = temCiclo
    ? firstInvoiceDueDate(data, card.closingDay!, card.dueDay!)
    : null;
  const ultimoVencimento =
    vencimento && nature === "PARCELADO" && installments >= 2
      ? addMonthsToDate(vencimento, installments - 1)
      : null;

  const dia = Number(data.slice(8, 10));
  const passouDaVirada = temCiclo && dia > card.closingDay!;

  return (
    <section className="glass p-2xl">
      <h2 className="mb-lg text-sm font-semibold tracking-tight">
        Lançar compra no {card.name}
      </h2>
      <p className="mb-lg text-xs leading-relaxed text-muted-foreground">
        Só compras deste cartão. Débito, pix e dinheiro entram por{" "}
        <span className="font-medium">Novo lançamento</span>; boleto e conta fixa,
        por <span className="font-medium">Contas a pagar</span>.
      </p>

      <ActionForm action={createTransactionForm} submitLabel="Lançar no cartão">
        {(state) => (
          <>
            {/* Já respondido pela própria tela: é saída, é crédito, é este cartão. */}
            <input type="hidden" name="type" value="EXPENSE" />
            <input type="hidden" name="method" value="CREDITO" />
            <input type="hidden" name="accountId" value={card.id} />

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

            <Field label="Forma" name="nature" required>
              <Select
                id="nature"
                name="nature"
                value={nature}
                onChange={(e) => setNature(e.target.value as "VISTA" | "PARCELADO")}
                required
              >
                <option value="VISTA">À vista</option>
                <option value="PARCELADO">Parcelado</option>
              </Select>
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
                  hint="A fatura mostra a parcela; a nota mostra o total. Escolha o que você tem na mão."
                >
                  <Select
                    id="amountMode"
                    name="amountMode"
                    value={amountMode}
                    onChange={(e) => setAmountMode(e.target.value as "TOTAL" | "PARCELA")}
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

            <Field
              label="Data da compra"
              name="date"
              required
              error={fieldError(state, "date")}
              hint={
                temCiclo
                  ? `Dia em que você comprou. O cartão fecha dia ${card.closingDay}.`
                  : "Dia em que você comprou."
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

            {/*
              A resposta para "essa compra cai em qual fatura?", no momento em
              que a pergunta aparece. Sem isso o usuário só descobre a virada
              depois, quando a fatura chega com o valor de outro mês.
            */}
            {vencimento ? (
              <p className="flex gap-md rounded-control border border-accent/40 bg-accent/10 p-lg text-xs leading-relaxed">
                <CalendarClock className="mt-xs size-4 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  {passouDaVirada ? (
                    <>
                      Comprou <strong>depois</strong> do fechamento (dia {card.closingDay}
                      ), então já pegou o ciclo seguinte:{" "}
                    </>
                  ) : (
                    <>
                      Comprou <strong>antes</strong> do fechamento (dia {card.closingDay}
                      ), então entra na fatura que está fechando:{" "}
                    </>
                  )}
                  <strong>fatura de {formatMonthLong(vencimento.slice(0, 7))}</strong>,
                  que vence em {vencimento.split("-").reverse().join("/")}.
                  {ultimoVencimento ? (
                    <>
                      <br />
                      {installments} parcelas: da fatura de{" "}
                      {formatMonthLong(vencimento.slice(0, 7))} até a de{" "}
                      {formatMonthLong(ultimoVencimento.slice(0, 7))}.
                    </>
                  ) : null}
                </span>
              </p>
            ) : (
              <p className="rounded-control border border-amber-500/40 bg-amber-500/10 p-lg text-xs leading-relaxed text-amber-200">
                Este cartão está sem dia de fechamento e vencimento. Sem eles a
                compra cai na própria data da compra, não na fatura — cadastre em
                Configurações → Contas e cartões para a fatura fechar certo.
              </p>
            )}

            {parcelas ? (
              <p className="rounded-control border border-border bg-muted/50 p-lg text-xs leading-relaxed">
                <span className="font-semibold">
                  {installments}x de {formatBRL(parcelas[0])}
                </span>
                {parcelas[0] !== parcelas[parcelas.length - 1] ? (
                  <>
                    {" "}
                    (as últimas de {formatBRL(parcelas[parcelas.length - 1])} — o
                    centavo que sobra da divisão vai nas primeiras)
                  </>
                ) : null}
                <br />
                Total {formatBRL(totalCents ?? 0)}, uma parcela por fatura.
              </p>
            ) : null}

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
    </section>
  );
}

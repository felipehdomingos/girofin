import { BillForm } from "@/components/bill-form";
import { BillList } from "@/components/bill-list";
import { PageHeader, StatCard } from "@/components/ui";
import { currentMonth, formatMonthLong, today } from "@/lib/dates";
import { getBillsForMonth, listAccounts, listCategories } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default function ContasPage() {
  const month = currentMonth();
  const bills = getBillsForMonth(month);
  const categories = listCategories();
  const accounts = listAccounts();

  const pending = bills.filter((b) => b.status !== "PAID");
  const overdue = bills.filter((b) => b.status === "OVERDUE");
  const pendingCents = pending.reduce((acc, b) => acc + b.bill.amountCents, 0);
  const overdueCents = overdue.reduce((acc, b) => acc + b.bill.amountCents, 0);
  const paidCents = bills
    .filter((b) => b.status === "PAID")
    .reduce((acc, b) => acc + (b.paidCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Contas a pagar"
        subtitle={`${formatMonthLong(month)} · contas fixas e boletos. Não confundir com as contas bancárias, que ficam em Configurações.`}
      />

      <div className="grid gap-xl sm:grid-cols-3">
        <StatCard
          label="Em aberto"
          cents={pendingCents}
          tone={pendingCents > 0 ? "negative" : "neutral"}
          hint={`${pending.length} ${pending.length === 1 ? "conta" : "contas"}`}
        />
        <StatCard
          label="Vencidas"
          cents={overdueCents}
          tone={overdueCents > 0 ? "negative" : "positive"}
          hint={
            overdue.length === 0
              ? "Nada atrasado"
              : `${overdue.length} ${overdue.length === 1 ? "conta" : "contas"} — pague hoje`
          }
        />
        <StatCard label="Já pago no mês" cents={paidCents} tone="positive" />
      </div>

      <div className="mt-xl grid gap-xl lg:grid-cols-[1.5fr_1fr]">
        <BillList bills={bills} accounts={accounts} today={today()} />
        <BillForm categories={categories} today={today()} />
      </div>
    </>
  );
}

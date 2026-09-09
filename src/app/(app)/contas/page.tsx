import { BillFormDialog } from "@/components/bill-form";
import { BillList } from "@/components/bill-list";
import { MonthNav } from "@/components/month-nav";
import { PageHeader, StatCard } from "@/components/ui";
import { currentMonth, today } from "@/lib/dates";
import { getBillsForMonth, listAccounts, listCategories } from "@/lib/repo";
import { requirePageUser } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const params = await searchParams;
  // O mÃªs vem da URL. Sem isso a tela ficava presa no mÃªs corrente, e uma
  // fatura que vence no mÃªs seguinte simplesmente nÃ£o existia para o usuÃ¡rio.
  const month = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : currentMonth();

  const bills = await getBillsForMonth(month);
  const categories = await listCategories();
  const accounts = await listAccounts();

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
        subtitle="Contas fixas, boletos e faturas de cartÃ£o. As contas bancÃ¡rias ficam em ConfiguraÃ§Ãµes."
        actions={
          <div className="flex flex-wrap items-center gap-md">
            <MonthNav month={month} basePath="/contas" />
            <BillFormDialog categories={categories} today={today()} />
          </div>
        }
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
              : `${overdue.length} ${overdue.length === 1 ? "conta" : "contas"} â€” pague hoje`
          }
        />
        <StatCard label="JÃ¡ pago no mÃªs" cents={paidCents} tone="positive" />
      </div>

      <div className="mt-xl">
        <BillList bills={bills} accounts={accounts} categories={categories} today={today()} />
      </div>
    </>
  );
}


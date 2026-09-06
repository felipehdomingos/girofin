import Link from "next/link";

import { EntryDialog } from "@/components/entry-dialog";
import { SetupAlert } from "@/components/setup-alert";
import { TransactionList } from "@/components/transaction-list";
import { PageHeader } from "@/components/ui";
import { currentMonth, formatMonthLong, today } from "@/lib/dates";
import {
  getMonthSummary,
  listAccounts,
  listCategories,
  listIncomeSources,
  listTransactions,
} from "@/lib/repo";

/**
 * Dados lidos do arquivo SQLite a cada requisição. Sem isso o Next
 * pré-renderizaria a página no build e ela mostraria para sempre o estado do
 * banco no momento em que o build rodou.
 */
export const dynamic = "force-dynamic";

/**
 * A página é a LISTA. Lançar acontece num modal.
 *
 * Antes os dois formulários ocupavam a metade de cima e empurravam a lista para
 * baixo da dobra — o histórico, que é o que se consulta o tempo todo, ficava
 * escondido atrás de formulários que se usa por dez segundos e fecha.
 */
export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.mes ?? "") ? params.mes! : currentMonth();

  const categories = listCategories();
  const accounts = listAccounts();
  const incomeSources = listIncomeSources();
  const transactions = listTransactions({ month });
  const summary = getMonthSummary(month);

  return (
    <>
      <PageHeader
        title="Lançamentos"
        subtitle={`${formatMonthLong(month)} · ${summary.transactionCount} ${
          summary.transactionCount === 1 ? "registro" : "registros"
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-md">
            <Link
              href="/configuracoes"
              className="cursor-pointer rounded-control border border-border px-xl py-md text-sm font-semibold transition-colors duration-200 hover:bg-muted"
            >
              Cadastros
            </Link>
            <EntryDialog
              categories={categories}
              accounts={accounts}
              incomeSources={incomeSources}
              today={today()}
            />
          </div>
        }
      />

      <SetupAlert hasAccounts={accounts.length > 0} />

      <TransactionList transactions={transactions} month={month} />
    </>
  );
}

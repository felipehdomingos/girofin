import { SettingsTabs } from "@/components/settings-tabs";
import { getBanks } from "@/lib/banks";
import { PageHeader } from "@/components/ui";
import { currentMonth } from "@/lib/dates";
import { VIZ_PALETTE } from "@/lib/palette";
import { currentUser, requirePageUser } from "@/lib/auth-http";
import {
  getMonthSummary,
  listAccountsWithBalance,
  listCategories,
  listIncomeSources,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Hub de cadastros: bancos e cartões, empresas, categorias.
 * Tudo que se cadastra uma vez e se usa o resto do tempo mora aqui.
 */
export default async function ConfiguracoesPage() {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const user = await currentUser();
  const month = currentMonth();
  const accounts = listAccountsWithBalance(month);
  const incomeSources = listIncomeSources();
  const categories = listCategories();
  const summary = getMonthSummary(month);
  // Lista oficial do Banco Central. Nunca lança: cai em cache ou lista mínima.
  const { banks } = await getBanks();

  // Gasto do mês por categoria, para definir o orçamento olhando o real
  // e não no escuro.
  const spentByCategory = Object.fromEntries(
    summary.byCategory.map((c) => [c.category.id, c.totalCents]),
  );

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Cadastros: contas bancárias e cartões, empresas e categorias"
      />
      <SettingsTabs
        accounts={accounts}
        banks={banks}
        incomeSources={incomeSources}
        incomeThisMonth={summary.byIncomeSource}
        categories={categories}
        spentByCategory={spentByCategory}
        nextAccountColor={VIZ_PALETTE[accounts.length % VIZ_PALETTE.length]}
        nextSourceColor={VIZ_PALETTE[incomeSources.length % VIZ_PALETTE.length]}
        nextCategoryColor={VIZ_PALETTE[categories.length % VIZ_PALETTE.length]}
        user={user}
      />
    </>
  );
}

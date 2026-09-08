import { SettingsTabs } from "@/components/settings-tabs";
import { getBanks } from "@/lib/banks";
import { PageHeader } from "@/components/ui";
import { currentMonth } from "@/lib/dates";
import { VIZ_PALETTE } from "@/lib/palette";
import { currentUserProfile, requirePageUser } from "@/lib/auth-http";
import {
  getMonthSummary,
  listAccountsWithBalance,
  listCategories,
  listIncomeSources,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Hub de cadastros: bancos e cartÃµes, empresas, categorias.
 * Tudo que se cadastra uma vez e se usa o resto do tempo mora aqui.
 */
export default async function ConfiguracoesPage() {
  // Autorizacao por pagina: o layout nao impede o segmento de rodar.
  await requirePageUser();

  const user = await currentUserProfile();
  const month = currentMonth();
  const accounts = await listAccountsWithBalance(month);
  const incomeSources = await listIncomeSources();
  const categories = await listCategories();
  const summary = await getMonthSummary(month);
  // Lista oficial do Banco Central. Nunca lanÃ§a: cai em cache ou lista mÃ­nima.
  const { banks } = await getBanks();

  // Gasto do mÃªs por categoria, para definir o orÃ§amento olhando o real
  // e nÃ£o no escuro.
  const spentByCategory = Object.fromEntries(
    summary.byCategory.map((c) => [c.category.id, c.totalCents]),
  );

  return (
    <>
      <PageHeader
        title="ConfiguraÃ§Ãµes"
        subtitle="Cadastros: contas bancÃ¡rias e cartÃµes, empresas e categorias"
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


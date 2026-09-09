"use client";

import { useState } from "react";
import { Landmark, Building2, CreditCard, Tags, UserRound } from "lucide-react";

import { AccountManager } from "./account-manager";
import { CategoryManager } from "./category-manager";
import { ProfileForm } from "./profile-form";
import type { Bank } from "@/lib/banks";
import type {
  AccountWithBalance,
  Category,
  IncomeSource,
  IncomeSourceTotal,
} from "@/lib/types";

/**
 * Cadastros num lugar só.
 *
 * Antes isso estava espalhado em duas rotas de rodapé (/carteiras e
 * /categorias) que só existiam no menu do desktop — no celular não havia como
 * chegar nelas. Um hub único resolve os dois problemas: o usuário sabe onde
 * procurar, e a navegação principal continua com 5 itens.
 *
 * Abas em estado local, não em rota: são três blocos pequenos do mesmo assunto,
 * e trocar de aba não é algo que alguém queira compartilhar por link.
 */

const ABAS = [
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "contas", label: "Contas", icon: Landmark },
  { id: "cartoes", label: "Cartões", icon: CreditCard },
  { id: "empresas", label: "Empresas", icon: Building2 },
  { id: "categorias", label: "Categorias", icon: Tags },
] as const;

type AbaId = (typeof ABAS)[number]["id"];

export function SettingsTabs({
  accounts,
  banks,
  incomeSources,
  incomeThisMonth,
  categories,
  spentByCategory,
  nextAccountColor,
  nextSourceColor,
  nextCategoryColor,
  user,
}: {
  accounts: AccountWithBalance[];
  banks: Bank[];
  incomeSources: IncomeSource[];
  incomeThisMonth: IncomeSourceTotal[];
  categories: Category[];
  spentByCategory: Record<string, number>;
  nextAccountColor: string;
  nextSourceColor: string;
  nextCategoryColor: string;
  user: { name: string; email: string; phone?: string | null; birthDate?: string | null; city?: string | null; state?: string | null; avatarDataUrl?: string | null } | null;
}) {
  const [aba, setAba] = useState<AbaId>("contas");

  return (
    <>
      <div
        role="tablist"
        aria-label="Cadastros"
        /* Rola na horizontal no celular em vez de quebrar linha ou espremer:
           três abas com ícone não cabem em 375px. */
        className="mb-2xl flex gap-sm overflow-x-auto border-b border-border"
      >
        {ABAS.map(({ id, label, icon: Icon }) => {
          const ativa = aba === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(id)}
              className={`flex shrink-0 cursor-pointer items-center gap-md border-b-2 px-lg py-md text-sm transition-colors duration-200 ${
                ativa
                  ? "border-accent font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {aba === "contas" ? (
        <AccountManager
          show="contas"
          accounts={accounts}
          banks={banks}
          incomeSources={incomeSources}
          incomeThisMonth={incomeThisMonth}
          nextAccountColor={nextAccountColor}
          nextSourceColor={nextSourceColor}
        />
      ) : null}

      {aba === "perfil" && user ? <ProfileForm profile={user} /> : null}

      {aba === "cartoes" ? (
        <AccountManager
          show="cartoes"
          accounts={accounts}
          banks={banks}
          incomeSources={incomeSources}
          incomeThisMonth={incomeThisMonth}
          nextAccountColor={nextAccountColor}
          nextSourceColor={nextSourceColor}
        />
      ) : null}

      {aba === "empresas" ? (
        <AccountManager
          show="empresas"
          accounts={accounts}
          banks={banks}
          incomeSources={incomeSources}
          incomeThisMonth={incomeThisMonth}
          nextAccountColor={nextAccountColor}
          nextSourceColor={nextSourceColor}
        />
      ) : null}

      {aba === "categorias" ? (
        <CategoryManager
          categories={categories}
          spentByCategory={spentByCategory}
          nextColor={nextCategoryColor}
        />
      ) : null}
    </>
  );
}

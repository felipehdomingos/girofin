"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ChartColumn,
  CalendarClock,
  TrendingUp,
  PiggyBank,
  CreditCard,
  Settings,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";

type NavUser = { name: string; email: string; avatarDataUrl?: string | null };

/**
 * Navegação principal: sidebar no desktop, barra inferior no mobile (a área que
 * o polegar alcança sem reposicionar a mão).
 *
 * São 6 itens, um a mais que o teto de 5 da guideline de Navigation Patterns.
 * A alternativa era deixar Configurações só no rodapé da sidebar — que é o que
 * havia antes e simplesmente NÃO EXISTE no celular: não havia como cadastrar um
 * banco pelo telefone. Item extra com ícone e rótulo custa menos que uma tela
 * inalcançável. A 375px cada item ainda fica com ~62px de largura, acima do
 * mínimo de 44px para alvo de toque.
 */

const BASE = [
  { href: "/", label: "Resumo", icon: LayoutDashboard },
  { href: "/relatorios", label: "Relatórios", icon: ChartColumn },
  { href: "/contas", label: "A pagar", icon: CalendarClock },
  { href: "/investimentos", label: "Investir", icon: TrendingUp },
  { href: "/economia", label: "Economia", icon: PiggyBank },
  { href: "/configuracoes", label: "Config", icon: Settings },
] as const;

/** Só aparece depois que existe pelo menos um cartão cadastrado. */
const CARTOES = { href: "/cartoes", label: "Cartões", icon: CreditCard } as const;

export function Nav({ hasCards = false, user }: { hasCards?: boolean; user?: NavUser | null }) {
  const pathname = usePathname();
  const displayName = user?.name || "Sua conta";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "GF";

  // Cartões entra logo depois de "A pagar", perto do assunto vizinho.
  const ITEMS = hasCards
    ? [...BASE.slice(0, 3), CARTOES, ...BASE.slice(3)]
    : [...BASE];

  // "/" só casa exato; as outras casam com as subrotas.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* ---------------------------------------------------------- desktop */}
      <nav
        aria-label="Navegação principal"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-muted/40 px-lg py-xl lg:flex"
      >
        <div className="mb-2xl px-md">
          <BrandLogo />
          <div className="mt-lg flex items-start justify-between gap-md">
            <div>
              <p className="text-sm font-semibold tracking-tight">Controle Financeiro</p>
              <p className="mt-xs text-xs text-muted-foreground">
                Organize hoje. Viva melhor.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </div>

        <ul className="flex flex-col gap-xs">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex cursor-pointer items-center gap-lg rounded-control px-lg py-md text-sm transition-colors duration-200 ${
                    active
                      ? "bg-primary/25 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {/* aria-hidden: o ícone é decorativo, o texto ao lado já nomeia
                      o link. Sem isso o leitor de tela anuncia o nome duas vezes. */}
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  {href === "/configuracoes" ? "Configurações" : label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex items-center gap-md border-t border-border px-md pt-lg">
          {user?.avatarDataUrl ? (
            // A URL foi validada e limitada no formulário de perfil.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarDataUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent" aria-hidden="true">
              {initials}
            </span>
          )}
          <span className="min-w-0">
            <strong className="block truncate text-xs">{displayName}</strong>
            <span className="block truncate text-[11px] text-muted-foreground">{user?.email || "Conta pessoal"}</span>
          </span>
        </div>
        <div className="mt-auto border-t border-border pt-lg">
          <LogoutButton />
        </div>
      </nav>

      {/* ----------------------------------------------------------- mobile */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-glass lg:hidden"
        /* Respeita a barra de gestos do iPhone — sem isso o último item fica
           embaixo do indicador do sistema. */
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  /* min-h-[56px]: acima do mínimo de 44x44px para alvo de toque. */
                  className={`flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-xs px-xs py-md text-[10px] transition-colors duration-200 ${
                    active ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon
                    className={`size-5 ${active ? "text-accent" : ""}`}
                    aria-hidden="true"
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

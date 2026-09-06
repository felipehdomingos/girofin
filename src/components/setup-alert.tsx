import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

/**
 * Aviso de por que o lançamento está bloqueado.
 *
 * Antes o bloqueio só aparecia DENTRO do popup — quem abrisse o app e não
 * clicasse em "Novo lançamento" não fazia ideia de que faltava algo, e quem
 * clicasse levava um "não pode" sem contexto na tela inteira. Aqui o motivo
 * vem antes da tentativa, com o caminho para resolver ao lado.
 */
export function SetupAlert({ hasAccounts }: { hasAccounts: boolean }) {
  if (hasAccounts) return null;

  return (
    <div
      role="alert"
      className="mb-2xl flex flex-wrap items-start justify-between gap-lg rounded-card border border-amber-500/40 bg-amber-500/10 p-xl"
    >
      <div className="flex min-w-0 items-start gap-lg">
        <AlertTriangle
          className="mt-xs size-5 shrink-0 text-amber-300"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">
            Lançamentos bloqueados: cadastre uma conta primeiro
          </p>
          <p className="mt-sm max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Todo gasto sai de algum lugar e toda entrada cai em algum lugar. Sem
            pelo menos uma conta ou cartão cadastrado, o saldo de cada conta não
            teria como bater com os lançamentos — e nenhum número da tela seria
            confiável. Leva menos de um minuto: cadastre a conta onde cai o seu
            salário e o cartão que você mais usa.
          </p>
        </div>
      </div>

      <Link
        href="/configuracoes"
        className="inline-flex shrink-0 cursor-pointer items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90"
      >
        Cadastrar agora
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

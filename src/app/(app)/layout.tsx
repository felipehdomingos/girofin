import { Nav } from "@/components/nav";
import { requirePageUser } from "@/lib/auth-http";
import { listAccounts } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requirePageUser();

  // O item "CartÃµes" sÃ³ existe depois que hÃ¡ cartÃ£o cadastrado â€” menu com
  // seÃ§Ã£o vazia Ã© ruÃ­do. Leitura barata: uma consulta de contas por navegaÃ§Ã£o.
  const hasCards = (await listAccounts()).some((a) => a.kind === "CARTAO");

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-on-accent"
      >
        Pular para o conteÃºdo
      </a>

      <div className="lg:flex">
        <Nav hasCards={hasCards} user={user} />
        <main
          id="conteudo"
          className="min-w-0 flex-1 px-xl pb-24 pt-xl lg:px-3xl lg:pb-3xl"
        >
          {children}
        </main>
      </div>
    </>
  );
}


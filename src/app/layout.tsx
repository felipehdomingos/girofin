import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import { Nav } from "@/components/nav";
import { listAccounts } from "@/lib/repo";
import "./globals.css";

/**
 * IBM Plex Sans + Mono — par "Financial Trust" da base de tipografia da skill,
 * indicado para banco/fintech. O Mono existe só para valor monetário: dígito
 * de largura fixa é o que faz coluna de dinheiro alinhar.
 *
 * Via next/font: as fontes são baixadas no build e servidas junto com o app.
 * Sem requisição a fonts.googleapis.com em runtime, sem FOUT, e o app abre
 * offline — que importa aqui, porque o banco de dados é local.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Controle Financeiro",
  description:
    "Lançamento de gastos, contas a pagar, projeção de investimentos e orientação para economizar.",
};

export const viewport: Viewport = {
  themeColor: "#0F172A",
  // Sem maximumScale/userScalable: bloquear zoom é falha de acessibilidade
  // (item "Disable zoom" na lista de anti-patterns de layout responsivo).
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // O item "Cartões" só existe depois que há cartão cadastrado — menu com
  // seção vazia é ruído. Leitura barata: uma consulta de contas por navegação.
  const hasCards = listAccounts().some((a) => a.kind === "CARTAO");
  return (
    <html
      lang="pt-BR"
      className={`${plexSans.variable} ${plexMono.variable}`}
      data-theme="dark"
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {/* Primeiro item do DOM: quem navega por teclado pula a navegação
            inteira em vez de tabular por ela em toda página. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-on-accent"
        >
          Pular para o conteúdo
        </a>

        <div className="lg:flex">
          <Nav hasCards={hasCards} />
          <main
            id="conteudo"
            /* pb-24 no mobile: a barra inferior é fixa e comeria o último card
               ("No content hidden behind fixed navbars"). */
            className="min-w-0 flex-1 px-xl pb-24 pt-xl lg:px-3xl lg:pb-3xl"
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

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
  title: "GiroFin",
  description:
    "GiroFin: lançamento de gastos, contas a pagar, projeção de investimentos e orientação para economizar.",
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
  return (
    <html lang="pt-BR" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

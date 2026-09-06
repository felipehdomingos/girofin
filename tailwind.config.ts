import type { Config } from "tailwindcss";

/**
 * Tokens vindos de design-system/girofin/MASTER.md.
 *
 * Toda cor aqui aponta para uma CSS variable definida em globals.css. Componente
 * nenhum escreve hex direto — trocar o tema é editar um arquivo, não caçar hex
 * espalhado por 40 componentes.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "on-primary": "var(--color-on-primary)",
        secondary: "var(--color-secondary)",
        "on-secondary": "var(--color-on-secondary)",
        accent: "var(--color-accent)",
        "on-accent": "var(--color-on-accent)",
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        card: "var(--color-card)",
        "card-foreground": "var(--color-card-foreground)",
        muted: "var(--color-muted)",
        "muted-foreground": "var(--color-muted-foreground)",
        border: "var(--color-border)",
        destructive: "var(--color-destructive)",
        "on-destructive": "var(--color-on-destructive)",
        ring: "var(--color-ring)",

        // Versões CLAREADAS para uso como TEXTO sobre fundo escuro.
        // Motivo: os tokens de preenchimento reprovam em contraste como texto.
        //   #059669 sobre o card #192134 = 4,27:1  -> reprova (mín. 4,5:1)
        //   #DC2626 sobre o fundo #0F172A = 3,70:1 -> reprova
        // Os claros passam com folga: 8,28:1 e 6,49:1.
        // Regra: fundo de botão usa accent/destructive; texto usa pos/neg.
        pos: "var(--color-pos-text)",
        neg: "var(--color-neg-text)",
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      spacing: {
        // Escala densa (Density 8/10) — dashboard, não landing page.
        xs: "2px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
        "3xl": "32px",
      },
      borderRadius: { card: "12px", control: "8px", modal: "16px" },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.1)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
      backdropBlur: { glass: "14px" },
      transitionDuration: { DEFAULT: "200ms" },
    },
  },
  plugins: [],
} satisfies Config;

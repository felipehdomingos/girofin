import { BrandLogo } from "@/components/brand-logo";

/**
 * Tela de espera entre o login e a home.
 *
 * Fica na raiz, e não em `(app)/`, de propósito: `loading.tsx` embrulha o que
 * está ABAIXO do seu segmento, nunca o layout do próprio segmento. Em
 * `(app)/loading.tsx` o layout de `(app)` — que consulta sessão e contas —
 * resolveria antes, e a espera continuaria em tela branca. Na raiz, o layout
 * raiz não busca nada, então o splash aparece na hora e cobre o caminho todo.
 *
 * O logo respira em vez de girar: girar um logotipo com palavra deixa o nome
 * ilegível. A barra indeterminada abaixo é quem diz "está carregando".
 * `prefers-reduced-motion` já é neutralizado globalmente no globals.css.
 */
export default function Loading() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash__logo">
        <BrandLogo />
      </div>

      <p className="splash__label">Preparando suas contas…</p>

      <span className="splash__track" aria-hidden="true">
        <span className="splash__bar" />
      </span>

      <span className="sr-only">Carregando</span>
    </div>
  );
}

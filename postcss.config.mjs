/**
 * Tailwind v3 (PostCSS puro em JS).
 *
 * Este projeto NÃO usa Tailwind v4 de propósito: a v4 depende de dois binários
 * nativos (@tailwindcss/oxide e lightningcss) que o Smart App Control desta
 * máquina bloqueia. Ver README > "Restrições do ambiente".
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;

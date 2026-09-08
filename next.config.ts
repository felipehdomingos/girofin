import type { NextConfig } from "next";

/**
 * CSP.
 *
 * `style-src` precisa de 'unsafe-inline' porque o Tailwind e o Next injetam
 * estilo inline no bootstrap. `img-src` precisa de `data:` porque o avatar do
 * perfil é guardado como data URL. O resto é fechado em 'self'.
 *
 * `frame-ancestors 'none'` é o que realmente barra clickjacking em navegador
 * moderno; `X-Frame-Options` fica junto para os que ainda não leem CSP.
 *
 * `worker-src 'self' blob:` é explícito de propósito: o `pdfjs-dist`, usado na
 * leitura de fatura, instancia o worker por URL `blob:`. Sem a diretiva isso
 * herda `default-src 'self'`, que não cobre `blob:` — e a leitura de fatura
 * quebraria sem erro visível, do mesmo jeito que a página de docs quebrou.
 */
const SWAGGER_CDN = "https://unpkg.com";

const csp = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  /*
   * O CDN aparece em script-src e style-src por causa de /api/docs, que carrega
   * o Swagger UI de lá. O certo seria servir os arquivos do próprio domínio,
   * mas `swagger-ui-dist` não está instalado e adicionar dependência foge do
   * escopo desta correção — quando ela entrar, o CDN sai daqui e as duas
   * diretivas voltam a 'self'.
   */
  `style-src 'self' 'unsafe-inline' ${SWAGGER_CDN}`,
  `script-src 'self' 'unsafe-inline' ${SWAGGER_CDN}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Azure App Service can start the minimal server without shipping the
  // complete development dependency tree.
  output: "standalone",

  // Não anunciar o framework: é reconhecimento de graça para quem procura alvo.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;

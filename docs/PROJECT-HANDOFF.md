# GiroFin — handoff para continuidade

Este documento resume o estado atual do projeto para que outro agente possa
continuar o trabalho sem depender do histórico da conversa.

## Estado atual

- Repositório: `felipehdomingos/girofin`
- Branches sincronizadas no commit `93d40b5` no momento deste registro:
  `develop`, `staging`, `Master` e `feat/azure-auth-postgres-api`.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 3, `node:sqlite`, PostgreSQL
  para identidade/API quando configurado.
- Deploy: Azure App Service Linux, Node 22, build standalone.
- Domínio de produção: `https://girofin.com.br`.
- Health de produção validado em `200`:
  `https://girofin.com.br/api/health`.

## UI implementada

A UI unificada do GiroFin foi aplicada ao app real em `src/`, preservando os
dados e regras existentes.

Arquivos principais:

- `src/app/(app)/layout.tsx`: shell autenticado e navegação.
- `src/app/(app)/page.tsx`: resumo com saudação do usuário.
- `src/components/nav.tsx`: sidebar, avatar, tema e navegação responsiva.
- `src/components/entry-dialog.tsx`: modal de novo lançamento e atualização
  após salvar.
- `src/app/globals.css`: tokens de tema claro/escuro e superfícies.
- `src/components/theme-toggle.tsx`: preferência de tema no dispositivo.

O protótipo visual original permanece em
`stitch_girofin_web_app_design/`; ele não é a fonte de execução do Next.js.

### Perfil

`Configurações > Perfil` permite editar nome, telefone, data de nascimento,
cidade, UF e foto. A foto aceita JPG, PNG ou WebP até 2 MB no cliente; o
backend valida novamente o Data URL e grava `avatar_data_url` no PostgreSQL.
As colunas de perfil são criadas de forma idempotente em `auth-db.ts` e também
estão declaradas em `db/postgres-schema.sql`. O e-mail permanece somente leitura
no perfil.

## Correções já feitas

- Salvamento no modal de lançamento chama `router.refresh()` para atualizar o
  histórico imediatamente.
- O shell recebe o usuário da sessão e calcula iniciais do avatar.
- O Resumo usa o nome do usuário autenticado.
- A navegação usa correspondência exata para `/`, evitando marcar Resumo em
  outras rotas.
- O protótipo estático preserva campos digitados ao trocar o tema e atualiza o
  histórico depois de salvar.

## Autenticação atual

Arquivos:

- `src/lib/auth-db.ts`: schema e operações de usuários, sessões e reset.
- `src/lib/auth-http.ts`: cookie de sessão e leitura da sessão atual.
- `src/app/api/v1/auth/login/route.ts`
- `src/app/api/v1/auth/register/route.ts`
- `src/app/api/v1/auth/logout/route.ts`
- `src/app/api/v1/auth/forgot-password/route.ts`
- `src/app/api/v1/auth/reset-password/route.ts`
- `src/app/api/v1/me/route.ts`

Situação de segurança:

- A sessão web atual usa token aleatório armazenado com HMAC no PostgreSQL e
  cookie `HttpOnly`, `Secure` em produção, `SameSite=lax`, `path=/` e prefixo
  `__Host-` em produção.
- Senhas usam `scrypt` com salt aleatório.
- Reset de senha usa token aleatório armazenado com HMAC, expiração e uso único.
- Login e recuperação não devem revelar existência de contas.
- Ainda NÃO existe contrato de access token + refresh token para mobile.
- Ainda NÃO existe rotação/revogação de refresh token.
- Ainda NÃO existe login Google.

Próxima implementação recomendada para mobile:

1. Criar tabela de famílias de refresh tokens com hash, expiração, dispositivo,
   revogação e vínculo ao usuário.
2. Adicionar `POST /api/v1/auth/refresh` com rotação a cada uso.
3. Invalidar a família inteira em caso de replay.
4. Adicionar `POST /api/v1/auth/revoke` para logout por dispositivo e
   `POST /api/v1/auth/revoke-all` para encerrar todas as sessões.
5. Emitir access token curto e documentar o fluxo no OpenAPI/Postman.
6. Manter cookie HttpOnly para web; o app mobile deve armazenar tokens usando
   armazenamento seguro do sistema operacional.

## API e documentação

- OpenAPI runtime: `GET /api/openapi.json`.
- Swagger UI: `GET /api/docs`.
- Prefixo da API: `/api/v1`.
- Contrato atual inclui identidade, sessão web e recuperação de senha.
- Ainda falta criar `postman/GiroFin.postman_collection.json` com variáveis:
  `baseUrl`, `email`, `password`, `accessToken` e `refreshToken`.
- A collection deve ter ambientes separados para staging e produção e nunca
  conter credenciais reais.

Padrão obrigatório de erro para a próxima versão:

```json
{
  "error": {
    "code": "INVALID_PASSWORD",
    "message": "A senha informada está incorreta."
  }
}
```

Mensagens devem ser úteis para o front, mas nunca revelar stack trace, SQL,
tokens, credenciais ou dados de outros usuários. A exceção é a mensagem
anti-enumeração de login/recuperação, quando revelar existência de conta for
risco.

## Banco e isolamento

- `src/lib/db.ts` usa SQLite para o fluxo financeiro atual.
- `src/lib/repo.ts` ainda trabalha com o banco financeiro local compartilhado.
- O PostgreSQL atual cobre identidade e sessões, não todos os dados financeiros.
- O app bloqueia armazenamento financeiro compartilhado em produção, exceto
  quando `ALLOW_UNSCOPED_FINANCEIRO_DB=true`.
- Essa variável foi configurada no App Service atual apenas para manter a demo
  funcionando; não é a arquitetura final multiusuário.
- Antes de uso financeiro real, migrar tabelas financeiras para PostgreSQL com
  `user_id` e validar isolamento entre contas.

## Azure e deploy

Workflows:

- `.github/workflows/deploy-staging.yml`: push em `staging`.
- `.github/workflows/deploy-production.yml`: push em `Master`.

Ambos fazem checkout, `npm ci`, `npm run build` e deploy de `.next/standalone`.
O startup do App Service é `node server.js`.

App Services encontrados:

- staging: `girofin-staging-1704`, resource group `girofin-staging-rg`.
- produção: `girofin-prod-1704`, resource group `girofin-prod-rg`.

Configuração mínima documentada no Azure:

- `APP_ENV=staging` ou `production`.
- `WEBSITE_NODE_DEFAULT_VERSION=~22`.
- `ALLOW_UNSCOPED_FINANCEIRO_DB=true` apenas enquanto a migração PostgreSQL
  não existir.
- `DATABASE_URL` e `AUTH_SECRET` para habilitar autenticação.
- `AZURE_WEBAPP_NAME` como variável do GitHub Environment.
- `AZURE_WEBAPP_PUBLISH_PROFILE` como secret do GitHub Environment.

Não registrar valores dessas configurações neste repositório.

## Comandos de validação

No Windows deste workspace, use `npm.cmd` se `npm` for bloqueado pela política
do PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run lint
```

O lint atual possui um erro preexistente em
`src/components/theme-toggle.tsx` (`react-hooks/set-state-in-effect`) e alguns
avisos. Typecheck, testes e build foram validados após a integração da UI.

## Agentes

- UX/UI: `docs/agents/ux-ui.md`.
- Dev frontend: `docs/agents/development.md`.
- Dev backend: `docs/agents/backend-development.md`.
- QA: `docs/agents/qa.md`.
- Documentação: `docs/agents/documentation.md`.
- Coordenação: `docs/AGENT-WORKFLOW.md` e `docs/AGENT-WORKLOG.md`.

O agente Dev Backend deve assumir como próximas entregas o refresh token,
contrato de erros, collection Postman, rate limiting, OAuth Google e migração
financeira multiusuário.

## Login Google — deixar para o final

Para implementar, será necessário o usuário fornecer/configurar fora do código:

- projeto OAuth no Google Cloud;
- client ID e secret armazenados no Azure/GitHub Secrets;
- domínios autorizados `girofin.com.br` e staging;
- redirect URIs exatas por ambiente;
- decisão sobre vincular por e-mail ou por `provider + subject`.

Nunca pedir ou registrar client secret em issue, commit, screenshot ou chat.

## Atualizacao da API mobile (2026-09-07)

A implementacao de access token e refresh token foi concluida. Login e cadastro
aceitam `client: mobile`; o access token dura 15 minutos, o refresh token dura
30 dias e e rotacionado a cada uso. Reuso de token revogado invalida a familia.
`/me` aceita cookie web ou Bearer token, e `logout` revoga as sessoes.

O contrato foi atualizado em `GET /api/openapi.json`. Para testes, importe a
collection `postman/GiroFin.postman_collection.json` e selecione um destes
ambientes: `postman/GiroFin-Staging.postman_environment.json` ou
`postman/GiroFin-Production.postman_environment.json`. Eles nao contem secrets.

Todas as rotas de autenticacao agora retornam erros no formato
`{ "error": { "code": "...", "message": "..." } }`, com mensagens acionaveis
para o front sem expor detalhes internos.

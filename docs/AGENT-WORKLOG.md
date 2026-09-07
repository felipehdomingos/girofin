# Registro central de trabalho dos agentes

Este arquivo coordena as frentes de UX/UI, documenta??o, desenvolvimento e QA.
Cada agente deve atualizar apenas sua se??o, registrar arquivos alterados,
decis?es, bloqueios e pr?ximos passos. Os registros individuais ficam em
`docs/agents/`.

## Estado inicial

- Reposit?rio: `felipehdomingos/girofin`
- Branch: `feat/azure-auth-postgres-api`
- Objetivo: preparar o projeto para a pr?xima etapa de desenvolvimento e deploy,
  com qualidade verific?vel e documenta??o utiliz?vel.
- Regra: n?o alterar credenciais, n?o fazer deploy real e n?o desfazer mudan?as
  existentes.

## Coordena??o

| Frente | Respons?vel | Registro individual | Status |
|---|---|---|---|
| UX/UI | agente UX/UI | `docs/agents/ux-ui.md` | Em andamento |
| Documenta??o | agente documentador | `docs/agents/documentation.md` | Conclu?do |
| Desenvolvimento | agente dev | `docs/agents/development.md` | Concluído |
| Backend | agente dev backend | `docs/agents/backend-development.md` | Pronto |
| QA | agente QA | `docs/agents/qa.md` | Em andamento |

## Backend

- Ação: criado o papel de Dev Backend em `docs/agents/backend-development.md`.
- Escopo: APIs versionadas para web/mobile, autenticação, refresh token,
  autorização, PostgreSQL multiusuário, OpenAPI, Postman e testes de segurança.
- Bloqueios atuais: o projeto ainda não implementa refresh token nem login
  social Google; ambos exigem decisão de arquitetura/configuração antes da
  implementação.

## Regras de atualiza??o

1. Registrar a??es concretas e caminhos de arquivos.
2. Separar claramente feito, recomendado e bloqueado.
3. N?o duplicar o trabalho de outra frente sem coordena??o.
4. Validar qualquer altera??o de c?digo com o menor comando existente adequado.
5. Ao concluir, atualizar o status da pr?pria linha na tabela acima.

## UX/UI

_Aguardando o relat?rio do agente._

## Documenta??o

- Arquivos revisados: `README.md`, `AZURE-SETUP.md`, `.env.example`, `src/app/api/openapi.json/route.ts`,
  `src/app/api/docs/page.tsx`, `src/app/api/v1/auth/*`, `src/lib/auth-db.ts`, `src/lib/auth-http.ts`.
- A??es executadas: alinhamento do nome do reposit?rio e da descri??o atual do projeto,
  corre??o de vari?veis de ambiente e deploy, atualiza??o da OpenAPI para refletir login,
  recupera??o e reset de senha, e revis?o das limita??es reais do SQLite local + PostgreSQL
  de autentica??o.
- Decis?es: manter o fluxo financeiro em SQLite, preservar a documenta??o do deploy Azure em
  `staging` e `Master`, n?o prometer multiusu?rio nem prote??o global antes da migra??o do
  modelo de dados.
- Valida??o: revis?o do c?digo e documenta??o relevantes; ajuste de patch em arquivos de docs
  e OpenAPI; checagem textual com `git diff --check`.
- Bloqueios: nenhum bloqueio funcional do escopo; a revis?o foi conclu?da dentro do que o
  reposit?rio implementa hoje.
- Pr?ximos passos: acompanhar a pr?xima etapa de `user_id`/autoriza??o em dados financeiros,
  atualizar o README e a Azure setup quando a migra??o para o PostgreSQL financeiro e a API
  protegida estiverem ativas.

## Desenvolvimento

- Ações: protegidas as telas financeiras em `src/app/(app)/layout.tsx`, sem
  alterar as URLs; o SQLite compartilhado agora falha fechado em
  `src/lib/db.ts` quando há deploy/auth sem liberação explícita; o artefato
  standalone remove `data/` em `scripts/prepare-standalone.cjs`; rotas API v1
  foram fixadas em Node.js, com `400` para JSON inválido e `23505` para
  conflito de cadastro; cookie renomeado para GiroFin.
- Arquivos: `src/app/layout.tsx`, `src/app/(app)/**`, `src/lib/auth-db.ts`,
  `src/lib/auth-http.ts`, `src/lib/db.ts`, `src/app/api/v1/**`,
  `scripts/prepare-standalone.cjs` e `docs/agents/development.md`.
- Decisões: não fazer migração especulativa do repositório síncrono SQLite;
  bloquear o modo compartilhado até `src/lib/repo.ts` usar PostgreSQL com
  `user_id`. SQLite permanece apenas para desenvolvimento local explícito.
- Validação: `npm run build`, `npm run typecheck`, `npm test` (155 testes) e
  `git diff --check`; o build gerou `.next/standalone/server.js` sem
  `.next/standalone/data`. Smoke test: `/login` `200`, `/` `500` sem modo
  local explícito e `/` `200` com `ALLOW_UNSCOPED_FINANCEIRO_DB=true`.
- Bloqueio: ainda falta a implementação do repositório financeiro PostgreSQL
  multiusuário; autenticação e schema já existem, mas não substituem as
  consultas financeiras atuais.
- Próximos passos: migrar `repo.ts` para PostgreSQL escopado pela sessão e
  testar isolamento entre usuários antes de liberar o deploy financeiro.

## QA

_Aguardando o relat?rio do agente._

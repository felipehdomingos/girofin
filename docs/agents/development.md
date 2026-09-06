# Registro do agente de desenvolvimento

## Escopo

Revisar a implementação atual em busca de lacunas diretamente relacionadas à
preparação para deploy, autenticação, PostgreSQL e renomeação para GiroFin.
Implementar somente correções justificadas e compatíveis com os padrões atuais.

## Ações

- Separei as telas financeiras em `src/app/(app)/` e criei
  `src/app/(app)/layout.tsx`, que valida a sessão antes de renderizar dados
  financeiros; as rotas públicas de login/cadastro continuam fora do layout
  protegido.
- Fiz a proteção falhar de forma segura em `src/lib/db.ts`: em produção ou
  quando há configuração de autenticação, o SQLite compartilhado não é aberto
  sem `ALLOW_UNSCOPED_FINANCEIRO_DB=true`.
- Ajustei `scripts/prepare-standalone.cjs` para remover `data/` do artefato
  standalone, evitando empacotar banco financeiro local ou dados do ambiente de
  desenvolvimento.
- Tornei as rotas da API v1 explicitamente Node.js, tratei JSON inválido como
  `400` e usei o código PostgreSQL `23505` para conflito de cadastro.
- Atualizei o cookie de sessão para `girofin_session` /
  `__Host-girofin_session`, alinhando a renomeação para GiroFin.

## Decisões

- Não migrei `src/lib/repo.ts` especulativamente: ele ainda é síncrono e
  baseado em `node:sqlite`, enquanto `db/postgres-schema.sql` já define o
  modelo multiusuário assíncrono. Em vez de permitir vazamento entre usuários,
  o modo compartilhado fica bloqueado quando autenticação/deploy está ativo.
- O layout protegido é um route group, portanto não altera URLs públicas e
  evita que páginas de autenticação inicializem o banco financeiro.
- O modo SQLite continua disponível para desenvolvimento local de usuário único;
  a liberação explícita deve ser usada somente nesse cenário.

## Bloqueios e próximos passos

- Bloqueio: a camada financeira ainda não usa o PostgreSQL com `user_id`; o
  schema existe, mas `src/lib/repo.ts` não tem uma implementação equivalente.
  O deploy multiusuário só deve liberar as telas financeiras após essa migração.
- Próximos passos: implementar um repositório financeiro PostgreSQL assíncrono
  com `user_id` derivado da sessão, migrar as consultas/mutações das telas e
  adicionar testes de isolamento entre dois usuários.
- Validação executada: `npm run build` (incluindo `prepare-standalone.cjs`),
  `npm run typecheck`, `npm test` (155 testes passando) e `git diff --check`.
  Smoke test do standalone: `/login` respondeu `200`, `/` respondeu `500` sem
  modo local explícito e voltou a `200` com `ALLOW_UNSCOPED_FINANCEIRO_DB=true`.

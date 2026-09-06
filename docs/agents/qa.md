# Registro do agente de QA

## Escopo

Executar a validação disponível no repositório, revisar riscos de regressão e
verificar os fluxos críticos de autenticação, API, dados financeiros e build.
Adicionar testes apenas se houver uma lacuna clara e alinhada ao projeto.

## Ações

- Executados `npm run typecheck`, `npm run lint`, `npm test` e `npm run build`.
- Feito smoke test local com `npm run dev -- --hostname 127.0.0.1 --port 3100`.
- Verificados `GET /api/health`, validação de entrada de login e recuperação,
  e acesso não autenticado a `GET /api/v1/me`.
- Revisados os fluxos em `src/app/api/v1/auth/*`, `src/lib/auth-db.ts`,
  `src/lib/auth-http.ts`, `src/lib/auth-email.ts` e o acesso financeiro em
  `src/lib/db.ts`, `src/lib/repo.ts` e `src/lib/actions.ts`.

## Decisões

- Nenhum código de produção foi alterado: os comandos passaram e o risco
  encontrado exige migração/isolamento de dados, não um ajuste pequeno seguro.
- A autenticação usa cookie HttpOnly, `SameSite=Lax`, `Secure` em produção,
  cookie `__Host-` em produção, scrypt para senhas, HMAC para tokens e invalida
  sessões ao redefinir a senha.
- O endpoint de recuperação mantém resposta genérica, reduzindo enumeração de
  e-mails; não há proteção visível contra rate limit/brute force.

## Bloqueios e próximos passos

- **Bloqueio crítico para multiusuário/produção:** as páginas e Server Actions
  financeiras continuam lendo e gravando `data/financeiro.db` via SQLite,
  sem chamar `currentUser()` e sem `user_id` no esquema local. A autenticação
  cria usuários/sessões no PostgreSQL, mas não conecta a sessão ao conjunto de
  dados financeiros. O próprio `/api/health` confirma `storage: "sqlite-local"`.
  Isso pode expor ou misturar dados entre usuários quando a autenticação for
  habilitada; registrar como defeito antes do deploy, sem corrigir aqui por ser
  uma alteração arquitetural ampla.
- Próximos passos: migrar o repositório financeiro para PostgreSQL (ou impor
  isolamento por usuário), exigir sessão nas rotas/ações protegidas, adicionar
  testes de autorização entre dois usuários e aplicar rate limiting/auditoria
  nos endpoints de autenticação.
- Evidência de smoke test: health `200`; login inválido `400`; recuperação com
  e-mail inválido `400`; `/api/v1/me` sem cookie `401`.

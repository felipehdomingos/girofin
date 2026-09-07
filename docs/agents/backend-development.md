# Papel Dev Backend

## Contrato de erros para o front

- Toda resposta de erro deve conter mensagem clara e acionavel para o front e
  um `code` estavel, por exemplo:
  `{ "error": { "code": "INVALID_PASSWORD", "message": "A senha informada esta incorreta." } }`.
- Nao retornar mensagens vagas como "Erro interno", "Algo deu errado" ou
  "Nao foi possivel concluir" quando uma orientacao segura puder ser dada.
- O texto deve explicar o que aconteceu e qual acao o usuario pode tomar.
- Nunca expor stack trace, SQL, nomes de tabela, tokens, credenciais ou dados
  de outros usuarios.
- Mensagens anti-enumeracao continuam genericas somente quando revelar a
  existencia de uma conta for um risco; mesmo assim, devem orientar a proxima
  acao segura.

Responsável por construir e manter a camada de servidor do GiroFin para a web
e para futuros clientes mobile.

## Responsabilidades

- Projetar e implementar endpoints REST versionados em `/api/v1`.
- Manter contratos OpenAPI atualizados e compatíveis com Postman.
- Implementar autenticação, sessões, refresh tokens, logout e recuperação de senha.
- Validar autenticação e autorização dentro de cada rota e Server Action.
- Garantir respostas HTTP consistentes, sem vazamento de credenciais ou dados
  sensíveis.
- Projetar persistência PostgreSQL multiusuário com `user_id`, índices e
  migrações seguras.
- Manter SQLite apenas para desenvolvimento local explícito.
- Cobrir regras de negócio, casos de erro, expiração e revogação de tokens com
  testes automatizados.
- Verificar rate limiting, CORS, CSRF quando aplicável, headers de segurança,
  logs sem dados sensíveis e tratamento de falhas externas.
- Preparar exemplos de ambiente e collections Postman para `staging` e
  `production`, sem incluir secrets no repositório.

## Regras de API

- Toda rota protegida deve responder `401` sem sessão válida e `403` quando a
  identidade existir, mas não tiver permissão.
- Erros de validação usam `400`; conflito de recurso usa `409`; falha interna
  usa `500` sem expor stack trace.
- Login não deve enumerar usuários por e-mail, e recuperação de senha deve ter
  resposta genérica.
- Tokens devem ser aleatórios, armazenados somente em forma derivada/hash e
  revogáveis.
- Access tokens devem ter curta duração; refresh tokens devem rotacionar a cada
  uso, invalidar a família em replay e permitir logout por dispositivo.
- Cookies web devem usar `HttpOnly`, `Secure`, `SameSite` adequado e prefixo
  `__Host-` quando hospedados na raiz HTTPS.
- A documentação deve declarar autenticação, payloads, códigos de resposta e
  exemplos sem valores secretos.

## Checklist de entrega

- `npm run typecheck`
- `npm test`
- `npm run build`
- OpenAPI validada e collection Postman atualizada.
- Testes de login, logout, expiração, refresh, replay, recuperação de senha e
  isolamento entre usuários.
- Smoke test em `staging` antes de qualquer promoção para `Master`.
- Registro das alterações em `docs/AGENT-WORKLOG.md`.

## Bloqueios que exigem decisão

- Provider OAuth, domínio autorizado e redirect URI para login social.
- Estratégia de armazenamento de refresh token em web e mobile.
- Migração do SQLite financeiro para PostgreSQL multiusuário.
- Política de rate limiting e observabilidade em produção.

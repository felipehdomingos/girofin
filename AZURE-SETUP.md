# Publicacao economica na Azure

Esta branch sera preparada em etapas. A ordem evita publicar o SQLite local em
um filesystem efemero e evita adicionar autenticacao antes de existir
isolamento por usuario.

## Arquitetura escolhida

- **Azure App Service Linux B1** para o Next.js.
- **Azure Database for PostgreSQL Flexible Server** na menor configuracao
  burstable disponivel.
- E-mail transacional somente quando o fluxo de recuperacao de senha entrar.
- GitHub Actions para publicar a branch de producao.

Para um projeto pequeno, App Service e PostgreSQL sao mais simples e previsiveis
que Kubernetes, Container Apps com varios recursos ou Azure SQL. O banco local
nao deve ser usado em producao: o filesystem do App Service nao e a fonte certa
para dados financeiros.

## Etapas

1. Preparacao do app: build standalone, health check e configuracao por ambiente.
2. PostgreSQL: schema, migracoes e importacao validada do SQLite.
3. Identidade: cadastro, login, sessao, confirmacao e recuperacao de senha.
4. Multiusuario: `user_id` em todos os dados e autorizacao em cada consulta.
5. API `/api/v1` e OpenAPI/Swagger.
6. Deploy, dominio HTTPS, backup, logs e monitoramento.

## Ambientes staging e production

As branches sao separadas:

- `staging`: ambiente de teste, deploy automatico pelo workflow
  `.github/workflows/deploy-staging.yml`;
- `Master`: ambiente de producao, deploy automatico pelo workflow
  `.github/workflows/deploy-production.yml`.

Em cada GitHub Environment (`staging` e `production`), configure:

```text
Variable: AZURE_WEBAPP_NAME
Secret:  AZURE_WEBAPP_PUBLISH_PROFILE
```

O `AZURE_WEBAPP_NAME` e o nome do App Service correspondente. O publish profile
vem de **Azure Portal > App Service > Get publish profile**. Use um App Service
separado para staging e producao; nao compartilhe o mesmo banco quando a
autenticacao e o PostgreSQL entrarem.

O App Service deve usar Node 22 e startup command:

```text
node server.js
```

O workflow publica `.next/standalone`, que ja inclui o servidor minimo e as
dependencias necessarias. O health check de staging sera:

```text
https://<app-staging>.azurewebsites.net/api/health
```

Ele deve retornar `"environment": "staging"`. Em producao, deve retornar
`"environment": "production"`.

## Health check

Depois do deploy, o App Service deve usar:

```text
/api/health
```

Nesta primeira etapa o endpoint confirma apenas o processo e o SQLite local.
Quando o PostgreSQL entrar, ele devera verificar a conexao PostgreSQL e
identificar o ambiente sem retornar informacao sensivel.

## Variaveis de ambiente

Copie `.env.example` para `.env.local` somente no desenvolvimento. Em Azure,
configure os valores em **App Service > Configuration > Application settings**.
Nao coloque senhas, tokens ou `DATABASE_URL` no repositorio.

O `DATABASE_URL`, `AUTH_SECRET` e as credenciais de e-mail ainda nao sao usados
pela aplicacao nesta etapa; eles serao ativados junto com as implementacoes
correspondentes para evitar uma falsa sensacao de seguranca.

## Identidade e API

Com `DATABASE_URL` e `AUTH_SECRET` configurados, a primeira camada de
autenticacao fica disponivel em:

```text
/cadastro
/login
/recuperar-senha
/redefinir-senha?token=...
/api/docs
/api/openapi.json
```

O reset de senha usa Resend quando `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL`
estao definidos. Em desenvolvimento sem esses valores, o link e impresso no
console; em producao a operacao falha explicitamente, sem expor o token na
resposta HTTP.

Esta camada ainda nao protege os dados financeiros existentes. A proxima etapa
e migrar as tabelas financeiras para PostgreSQL, adicionar `user_id` e exigir
sessao em cada leitura/escrita antes de ativar a protecao global das rotas.

O schema inicial dessa migracao esta em `db/postgres-schema.sql`. Com um
PostgreSQL de staging criado, configure `DATABASE_URL` e execute:

```bash
npm run db:apply
```

O comando e idempotente e nao apaga dados. O importador do SQLite sera usado
somente depois de o usuario de destino ser criado e o schema validado.

## Custo e controle

Antes de criar recursos, confira no portal o custo estimado para a regiao. Nao
habilite slots de staging, NAT Gateway, Application Gateway ou banco redundante
na primeira versao. Configure alerta de custo mensal e desligue ambientes de
teste quando nao estiverem em uso.

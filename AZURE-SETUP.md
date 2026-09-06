# Publica??o econ?mica na Azure

Esta branch ser? preparada em etapas. A ordem evita publicar o SQLite local em
um filesystem ef?mero e evita adicionar autentica??o antes de existir
isolamento por usu?rio.

O estado atual do reposit?rio j? inclui a camada de autentica??o e a API
`/api/v1`, mas o banco financeiro continua em SQLite local. O PostgreSQL entra
na opera??o quando `DATABASE_URL` e `AUTH_SECRET` s?o configurados e o schema
for aplicado.

## Arquitetura escolhida

- **Azure App Service Linux B1** para o Next.js.
- **Azure Database for PostgreSQL Flexible Server** na menor configura??o
  burstable dispon?vel.
- E-mail transacional somente quando o fluxo de recupera??o de senha entrar.
- GitHub Actions para publicar a branch de produ??o.

Para um projeto pequeno, App Service e PostgreSQL s?o mais simples e previs?veis
que Kubernetes, Container Apps com v?rios recursos ou Azure SQL. O banco local
n?o deve ser usado em produ??o: o filesystem do App Service n?o ? a fonte certa
para dados financeiros.

## Etapas

1. Prepara??o do app: build standalone, health check e configura??o por ambiente.
2. PostgreSQL: schema, migra??es e importa??o validada do SQLite.
3. Identidade: cadastro, login, sess?o, confirma??o e recupera??o de senha.
4. Multiusu?rio: `user_id` em todos os dados e autoriza??o em cada consulta.
5. API `/api/v1` e OpenAPI/Swagger.
6. Deploy, dom?nio HTTPS, backup, logs e monitoramento.

## Ambientes staging e production

As branches s?o separadas:

- `staging`: ambiente de teste, deploy autom?tico pelo workflow
  `.github/workflows/deploy-staging.yml`;
- `Master`: ambiente de produ??o, deploy autom?tico pelo workflow
  `.github/workflows/deploy-production.yml`.

Em cada GitHub Environment (`staging` e `production`), configure:

```text
Variable: AZURE_WEBAPP_NAME
Secret:  AZURE_WEBAPP_PUBLISH_PROFILE
```

O `AZURE_WEBAPP_NAME` ? o nome do App Service correspondente. O publish profile
vem de **Azure Portal > App Service > Get publish profile**. Use um App Service
separado para staging e produ??o; n?o compartilhe o mesmo banco quando a
autentica??o e o PostgreSQL entrarem.

O App Service deve usar Node 22 e startup command:

```text
node server.js
```

O workflow publica `.next/standalone`, que j? inclui o servidor m?nimo e as
depend?ncias necess?rias. O health check de staging ser?:

```text
https://<app-staging>.azurewebsites.net/api/health
```

Ele deve retornar `"environment": "staging"`. Em produ??o, deve retornar
`"environment": "production"`.

## Health check

Depois do deploy, o App Service deve usar:

```text
/api/health
```

Nesta primeira etapa o endpoint confirma apenas o processo e o SQLite local.
Quando o PostgreSQL entrar, ele dever? verificar a conex?o PostgreSQL e
identificar o ambiente sem retornar informa??o sens?vel.

## Vari?veis de ambiente

Copie `.env.example` para `.env.local` somente no desenvolvimento. Em Azure,
configure os valores em **App Service > Configuration > Application settings**.
N?o coloque senhas, tokens ou `DATABASE_URL` no reposit?rio.

As vari?veis atualizadas pela aplica??o s?o:

```text
FINANCEIRO_DB
DATABASE_URL
AUTH_SECRET
APP_URL
APP_ENV
DATABASE_POOL_MAX
DATABASE_SSL
EMAIL_FROM
RESEND_API_KEY
```

`EMAIL_SERVER_*` n?o s?o usados pelo c?digo atual. O reset de senha usa Resend
quando `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` est?o definidos.

## Identidade e API

Com `DATABASE_URL` e `AUTH_SECRET` configurados, a primeira camada de
autentica??o fica dispon?vel em:

```text
/cadastro
/login
/recuperar-senha
/redefinir-senha?token=...
/api/docs
/api/openapi.json
```

As rotas de API reais do projeto est?o em `/api/v1/auth/*` e `/api/v1/me`.
O reset de senha usa Resend quando `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL`
est?o definidos. Em desenvolvimento sem esses valores, o link ? impresso no
console; em produ??o a opera??o falha explicitamente, sem expor o token na
resposta HTTP.

Esta camada ainda n?o protege os dados financeiros existentes. A pr?xima etapa
? migrar as tabelas financeiras para PostgreSQL, adicionar `user_id` e exigir
sess?o em cada leitura/escrita antes de ativar a prote??o global das rotas.

O schema inicial dessa migra??o est? em `db/postgres-schema.sql`. Com um
PostgreSQL de staging criado, configure `DATABASE_URL` e execute:

```bash
npm run db:apply
```

O comando ? idempotente e n?o apaga dados. O importador do SQLite ser? usado
somente depois de o usu?rio de destino ser criado e o schema validado.

## Custo e controle

Antes de criar recursos, confira no portal o custo estimado para a regi?o. N?o
habilite slots de staging, NAT Gateway, Application Gateway ou banco redundante
na primeira vers?o. Configure alerta de custo mensal e desligue ambientes de
teste quando n?o estiverem em uso.

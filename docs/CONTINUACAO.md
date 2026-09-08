# Passagem de bastão — onde o trabalho parou

Escrito em 08/09/2026. Documento auto-contido: quem pegar daqui não precisa do
histórico da conversa anterior.

Leia junto com:
- `docs/SEGURANCA.md` — a auditoria completa, 20 achados com severidade e correção
- `docs/FLUXO.md` — o fluxo de branches e deploy

---

## Contexto em um parágrafo

O GiroFin passou por duas rodadas de auditoria de segurança. Dos 20 achados,
16 foram corrigidos, verificados (`typecheck`, 23/23 testes, `build`) e estão
em produção. Sobraram quatro pendências de código e cinco de configuração de
ambiente. **A pendência mais grave é a de número 1 abaixo: os dados
financeiros não têm isolamento por usuário.** Hoje isso não vaza porque uma
trava fail-closed impede a aplicação de abrir o banco compartilhado — mas essa
trava também impede o app de funcionar em multiusuário.

---

## Estado atual, verificado

### Branches

| Branch | Commit | Situação |
|---|---|---|
| `Master` | `c38ce96` | publicado em produção |
| `develop` | `c38ce96` | sincronizada |
| `staging` | `c0b387a` | **atrasada em 2 commits** |

`staging` reconcilia por fast-forward (`git merge --ff-only develop`). O push
dispara o `deploy-staging.yml`.

### O que está publicado

Produção (`girofin-prod-1704`) e staging (`girofin-staging-1704`) rodam o
código com as correções de segurança. Confirmado por sondagem: headers de
segurança presentes, `X-Powered-By` ausente, `/api/v1/auth/resend-verification`
responde 503 (existe) em vez de 404.

**A aplicação não funciona hoje.** `authConfigured()` é
`Boolean(DATABASE_URL && AUTH_SECRET)`, e as duas estão erradas ou vazias — ver
"Pendências de ambiente". Login responde 503, `/api/health` responde
`{"ok":false}`. Isso é configuração, não código.

---

## Pendências de ambiente (Azure) — fazer nesta ordem

Nenhuma se resolve no repositório. Todas em App Settings do App Service.

Dados de referência, já confirmados:
- Servidor: `girofin-db-prod-1704.postgres.database.azure.com` (PostgreSQL 16, Ready)
- Usuário admin: `girofinadmin`
- Bancos: `girofin_prod` e `girofin_staging` (ambos vazios)

### E1 — `DATABASE_URL` está sem o host, nos dois ambientes

Valor atual, nos dois:

```
postgresql://girofinadmin:SENHA@/girofin_prod?sslmode=require
                                ↑ o @ vem colado na /, falta o servidor
```

Correção: inserir o host entre `@` e `/`, **sem redigitar a senha** (se ela
tiver caractere especial, precisa estar percent-encoded, e redigitar é onde
isso quebra).

```
postgresql://girofinadmin:SENHA@girofin-db-prod-1704.postgres.database.azure.com/girofin_prod?sslmode=require
```

Em staging o banco no final é **`girofin_staging`**, não `girofin_prod` — trocar
isso faz staging escrever no banco de produção.

Caminho no portal: App Services → o app → Settings → Environment variables →
App settings → `DATABASE_URL`. Salvar reinicia o app sozinho.

### E2 — `AUTH_SECRET` vazia em produção, ausente em staging

A chave existe em produção com valor vazio; em staging não existe. Sem ela a
autenticação inteira fica desligada.

**Mínimo de 32 caracteres** — o código recusa subir com menos, de propósito
(não existe mais fallback hardcoded). Gerar com
`openssl rand -base64 48` ou equivalente. Valores diferentes por ambiente.

E1 e E2 juntas são o que liga a autenticação. Só depois das duas dá para testar
cadastro, confirmação de e-mail e login.

### E3 — A mesma chave do Resend nos dois ambientes

`RESEND_API_KEY` é idêntica em produção e staging (36 chars, prefixo `re_`,
mesmo final). Consequências: teste em staging dispara e-mail real saindo de
`no-reply@girofin.com.br`; um vazamento pelo ambiente menos protegido só se
resolve revogando a chave, o que derruba produção junto; e bounce gerado em
staging queima a reputação que produção usa para entregar código de
confirmação.

Gerar uma chave por ambiente no Resend. Idealmente verificar um subdomínio
separado para staging.

### E4 — Staging sem as variáveis de autenticação

Faltam: `AUTH_SECRET`, `APP_URL`, `APP_ENV`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

Sem `APP_URL`, `sendPasswordResetEmail` e `sendAccountExistsEmail` recusam
enviar (guarda proposital, para não mandar link `undefined/...` e queimar um
token de uso único). O e-mail de código de confirmação funciona sem ela, porque
não usa link.

### E5 — Firewall do Postgres só libera serviços do Azure

Única regra: `AllowAllAzureServicesAndResourcesWithinAzureIps` (`0.0.0.0`). O
App Service alcança o banco; nenhuma máquina de desenvolvimento alcança.
Verificado: o DNS resolve (`20.226.33.134`), a porta 5432 não responde.

**É isto que bloqueia a pendência C1.** Uma regra liberando o IP público da
máquina de desenvolvimento, apontando para `girofin_staging`, destrava.

---

## Pendências de código

### C1 — 🔴 Dados financeiros sem isolamento por usuário

**A pendência mais grave, e o bloqueador de lançamento.**

`src/lib/repo.ts` (1615 linhas, 48 funções, 46 chamadas a `getDb()`) não tem
uma única referência a `userId`. `getDb()` abre sempre o mesmo arquivo SQLite.
O schema confirma que é monousuário: `accounts.name`, `categories.name` e
`income_sources.name` são `UNIQUE` globais, e não existe coluna `user_id` em
tabela nenhuma.

As guardas de sessão adicionadas nas Server Actions e nas páginas resolvem
**autenticação**, não **escopo**: qualquer conta confirmada continuaria lendo e
apagando dados de todas as outras, porque `deleteTransactionAction(id)` e
similares recebem um id arbitrário e o repositório executa
`DELETE ... WHERE id = ?` sem coluna de dono.

**O que segura isso hoje:** `assertFinanceStorageMode()` em `src/lib/db.ts`
lança exceção quando `NODE_ENV=production` ou `authConfigured()`, a menos que
`ALLOW_UNSCOPED_FINANCEIRO_DB=true`. Hoje a variável está `false` nos dois
ambientes, então a aplicação **quebra em vez de vazar**. É fail-closed e está
correto.

**Consequência prática:** assim que E1 e E2 forem resolvidas e o login voltar a
funcionar, **todas as telas financeiras vão lançar erro**. Isso é o esperado,
não é regressão — é a trava fazendo o trabalho dela. C1 precisa estar pronto
antes de haver usuários reais.

**Caminho decidido:** migrar o financeiro para o PostgreSQL que já existe
(multi-tenant), não SQLite por usuário.

- Adicionar `user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE`
  em todas as tabelas financeiras
- Trocar os `UNIQUE` globais por `UNIQUE (user_id, name)`
- Toda função do `repo.ts` recebe `userId` e filtra por ele
- As funções passam de síncronas a assíncronas (o `pg` é async), o que muda os
  ~11 `page.tsx` e as 27 Server Actions que as consomem
- Traduzir o dialeto: `datetime('now')` → `now()`, `GLOB` → `~`, booleano 0/1 →
  `boolean`, placeholders `?` → `$1`
- Script de migração dos dados de `data/financeiro.db`, se houver dados a
  preservar

**Não faça isso às cegas.** A suíte de 23 testes (`scripts/test-lib.ts`,
`test-fatura.ts`, `test-invoice.ts`, `test-amarracao.ts`) roda contra um arquivo
SQLite e é o que hoje protege o cálculo de fatura, parcelamento e projeção de
contas. A migração desliga essa suíte. Resolva E5 primeiro, aponte um
`DATABASE_URL` local para `girofin_staging` e desenvolva com o banco
alcançável — traduzir 1615 linhas sem conseguir executar nenhuma tem alta
probabilidade de quebrar lógica financeira que hoje funciona.

Depois de C1 pronto: remover `assertFinanceStorageMode()` e o código morto
(`src/lib/finance-user.ts` inteiro, `getDbForUser`, `getDbForCurrentUser` —
nenhum é chamado de lugar nenhum hoje).

### C2 — 🟡 CSP com `'unsafe-inline'` em `script-src`

`next.config.ts`. Anula a principal proteção da CSP contra XSS. Não há sink de
XSS conhecido no código (auditado: zero `dangerouslySetInnerHTML`, `innerHTML`,
`eval`), então é defesa em profundidade, não falha ativa.

Existe porque o App Router injeta scripts inline para transmitir o RSC Payload
(`self.__next_f.push`). Sem `'unsafe-inline'` nem nonce, o app não carrega.

Correção: nonce por requisição via `proxy.ts` (em Next 16 o `middleware.ts` foi
descontinuado e renomeado para `proxy.ts`), trocando `'unsafe-inline'` por
`'nonce-<valor>'`.

### C3 — 🔵 `unpkg.com` liberado na CSP global

Mesma linha do `next.config.ts`. `/api/docs` carrega o Swagger UI de
`https://unpkg.com`, então o host foi liberado em `script-src` e `style-src` —
mas na CSP **global**, o que permite a um CDN de terceiro executar script em
qualquer página, não só na de docs.

Não é exposição nova (a página já carregava de lá, sem SRI), mas a CSP deixou
de barrar isso em qualquer lugar. Duas saídas: instalar `swagger-ui-dist` e
servir do próprio domínio (é um pacote só, e a constante `SWAGGER_CDN` no
arquivo já está isolada para facilitar), ou não expor `/api/docs` em produção.

### C4 — 🔵 Avatar de até 2,8 MB no payload de toda navegação

`app_users.avatar_data_url` entra no `SELECT` de validação de sessão
(`getUserBySession`), e o `nav.tsx` renderiza o avatar no layout — ou seja, o
data URL vai no RSC Payload de **toda** página autenticada e na resposta de
`/api/v1/me`.

Não é falha de segurança. Não foi corrigido porque tirar o campo do `SELECT`
quebraria o avatar da navegação. Correção real: servir o avatar por rota
dedicada com cache, ou mover para Blob Storage guardando só a URL.

---

## Pendências no GitHub (interface, não código)

### G1 — Trocar a branch padrão para `develop`

Settings → General → Default branch. Hoje é `Master`, e por isso a PR #1 nasceu
apontando para produção e foi mergeada direto lá, pulando `develop` e
`staging` — exatamente o que `docs/FLUXO.md` diz para não fazer. Trocar a
padrão faz toda PR nova nascer com a base certa.

### G2 — Proteção de branch

Settings → Branches → Add branch ruleset.

- `Master`: exigir pull request, exigir o check **CI**, bloquear push direto
- `staging`: exigir o check **CI**

O check "CI" só aparece na lista depois de ter rodado ao menos uma vez.

### G3 — Alinhar a branch `staging`

```bash
git checkout staging && git merge --ff-only develop && git push origin staging
```

Fast-forward limpo. O push publica em staging.

---

## Regras para quem continuar

**Código só entra por `develop`.** Nunca commite direto em `staging` ou
`Master`. As duas avançam por fast-forward a partir de `develop`; commit direto
faz as três divergirem. Ver `docs/FLUXO.md` para o passo a passo completo.

**Valide antes de commitar:**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

O `ci.yml` roda os quatro em todo PR e em todo push para `develop`, `staging` e
`Master`.

**Não reintroduza os bypasses removidos.** `src/lib/db.ts` tinha duas exceções
que ligavam o modo de banco compartilhado: `WEBSITE_SITE_NAME` começando com
`girofin-staging-` (o Azure define essa variável, então a proteção dependia do
nome do recurso — e o slot real casa com o prefixo) e `APP_ENV === "staging"`.
As duas foram removidas de propósito. Sobrou só
`ALLOW_UNSCOPED_FINANCEIRO_DB`, explícita.

**Não coloque segredo em log.** Os únicos logs com dado sensível
(`auth-email.ts`) estão dentro de `if (NODE_ENV !== "production")` e só são
alcançados quando o Resend não está configurado. Manter assim.

**Leia as docs do Next antes de escrever código.** Esta versão tem mudanças
que quebram compatibilidade com o que os modelos têm memorizado — as docs da
versão instalada estão em `node_modules/next/dist/docs/`. Dois exemplos que já
importaram aqui: `middleware.ts` virou `proxy.ts`, e o guia de autenticação
(linha 1354) diz explicitamente que um layout **não** controla se o resto da
rota renderiza, o que invalidava a autorização que existia antes.

---

## Como verificar que algo está no ar

```bash
# produção
H=girofin-prod-1704-c7dygqgvhdb5fbf3.brazilsouth-01.azurewebsites.net
curl -sI "https://$H/login" | grep -iE "content-security|x-powered-by"
curl -s "https://$H/api/health"

# staging
H=girofin-staging-1704-endtbcbkgvgneqee.brazilsouth-01.azurewebsites.net
```

Sinais do código corrigido: `Content-Security-Policy` presente,
`X-Powered-By` ausente, e `POST /api/v1/auth/resend-verification` respondendo
503 (rota existe, autenticação desligada) em vez de 404 (rota não existe).

Ler App Settings sem expor segredo:

```powershell
$env:AZURE_CONFIG_DIR = Join-Path $env:TEMP 'girofin-azure-cli'
az webapp config appsettings list --resource-group girofin-prod-rg `
  --name girofin-prod-1704 --query "[].name" -o tsv
```

`az` nesta máquina precisa do `AZURE_CONFIG_DIR` apontando para o TEMP —
sem isso dá `PermissionError` em `~/.azure/azureProfile.json`.

---

## Arquivos não versionados na raiz

`Microsoft.Services.Store.winmd`, `stitch_girofin_web_app_design/` e
`docs/RELATORIO-AUDITORIA-SEGURANCA.{md,docx}` estão sem rastreamento de
propósito. Os dois primeiros não parecem pertencer ao projeto; o relatório é
uma auditoria anterior, cujo conteúdo já foi absorvido e ampliado no
`docs/SEGURANCA.md`. Confira antes de qualquer `git add -A`.

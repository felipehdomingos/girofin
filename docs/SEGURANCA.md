# Auditoria de segurança — GiroFin

Data: 2026-09-07 (revisão 2) · Branch: `develop` · Base: `68a9c08` + alterações não commitadas
Alvo: `src/` (75 arquivos TS/TSX), Next.js 16.3.4 (App Router, `output: standalone`)

Método: leitura do código de autenticação, sessão, camada de dados e Server Actions;
sondagem do servidor de produção (`node .next/standalone/server.js`); `npm audit`;
conferência do comportamento do framework contra as docs em `node_modules/next/dist/docs/`.

> **Revisão 2** — reauditoria completa após as mudanças em login, cadastro e
> confirmação de e-mail (`auth-db.ts`, `auth-email.ts`, rotas `register`/`login`,
> nova rota `verify-email`, `auth-form.tsx`, `.env.example`). O que mudou em
> relação à revisão 1 está resumido na seção [O que mudou](#o-que-mudou-desde-a-revisão-1).

---

## Resumo

Status: ✅ corrigido e verificado · ⚠️ corrigido com ressalva · ⛔ pendente

| # | Sev. | Falha | Status |
|---|---|---|---|
| 1 | 🔴 | Dados financeiros globais, sem escopo por usuário | ⛔ **bloqueado** — ver [Item 1](#1--dados-financeiros-são-globais-sem-escopo-por-usuário) |
| 2 | 🔴 | Autorização feita só no layout — não protege a rota | ✅ `requirePageUser()` em 7 páginas |
| 3 | 🔴 | 26 de 27 Server Actions sem checagem de sessão | ✅ guarda nas 26 |
| 4 | 🟠 | Código de 6 dígitos sem limite de tentativas | ✅ coluna `attempts` + queima em 5 erros |
| 5 | 🟠 | Zero rate limiting em toda a superfície de auth | ✅ `rate-limit.ts`, 429 verificado |
| 6 | 🟠 | TLS do Postgres sem validar certificado | ✅ `rejectUnauthorized: true` + CA |
| 7 | 🟠 | Trava do banco compartilhado desligada em staging | ✅ bypasses removidos de `db.ts` |
| 8 | 🟠 | Login Google contorna a confirmação de e-mail | ✅ vínculo só com e-mail comprovado |
| 9 | 🟠 | Conta órfã permanente: não existe reenvio de código | ✅ rota `/resend-verification` + rollback |
| 10 | 🟡 | `AUTH_SECRET` com fallback hardcoded | ✅ falha no boot, sem fallback |
| 11 | 🟡 | Cookie de sessão e access token são intercambiáveis | ✅ coluna `kind` + escopo no logout |
| 12 | 🟡 | Nenhum header de segurança; `X-Powered-By` exposto | ⚠️ 6 headers ativos; CSP com ressalva |
| 13 | 🟡 | `resetToken` na resposta fora de produção | ✅ removido do corpo HTTP |
| 14 | 🟡 | `APP_URL` deixou de ser validado | ✅ guarda restaurada |
| 15 | 🟡 | Enumeração de contas (registro e login) | ✅ resposta uniforme + hash dummy |
| 16 | 🔵 | `importInvoiceAction` sem validação nem limite | ✅ schema Zod, teto de 500 |
| 17 | 🔵 | Avatar de 2,8 MB relido em toda validação de sessão | ⛔ não corrigido — ver o item |
| 18 | 🔵 | Registro mobile deixou de funcionar | ⚠️ campo `client` removido; fluxo a definir |
| 19 | 🔵 | Código morto de escopo | ⛔ acoplado ao item 1 |
| 20 | 🟠 | E-mail de recuperação de senha nunca era enviado | ✅ **novo achado** — fluxo ligado |

**Verificação do que foi aplicado:** `npm run typecheck` limpo; `npm test`
23/23 passando; `npm run build` com `failed:true` ausente do trace; e, contra o
build de produção rodando, os 6 headers presentes com `X-Powered-By` ausente e
o login devolvendo `429` a partir da 6ª tentativa (`503 503 503 503 503 429 429`).

O único erro de lint no projeto (`set-state-in-effect` em
`src/components/theme-toggle.tsx:22`) é anterior a estas mudanças e não foi
tocado.

**O que está correto e não precisa mexer:** nenhuma injeção de SQL (todas as 46
consultas do `repo.ts` e todas as do `auth-db.ts` são parametrizadas); `npm audit`
limpo (0 vulnerabilidades); nenhum segredo versionado e `/data` no `.gitignore`;
o OAuth do Google valida `aud`, `iss` e `email_verified`; rotação de refresh token
com invalidação de família em replay; senha com scrypt + `timingSafeEqual`;
`state` do OAuth comparado em tempo constante; avatar validado por MIME e tamanho;
e — novo nesta revisão — o código de confirmação é gerado com `randomInt` (CSPRNG),
guardado apenas como HMAC, invalidado ao gerar outro, e conferido dentro de
transação com `FOR UPDATE`.

---

## O que mudou desde a revisão 1

**Corrigido:**

- O registro **não autentica mais automaticamente**. Antes, `POST /register`
  chamava `setAuthSession()` e devolvia sessão válida na hora; agora devolve 201
  e um código de confirmação por e-mail.
- O login **recusa e-mail não confirmado** (`login/route.ts:18`, 403
  `EMAIL_NOT_VERIFIED`).
- Existe fluxo de verificação de e-mail de ponta a ponta: tabela
  `email_verification_tokens`, `createEmailVerification()`, `verifyEmail()`,
  rota `POST /api/v1/auth/verify-email` e tela no `auth-form.tsx`.
- E-mails transacionais ganharam `reply_to` e remetente `no-reply` dedicado.

**Continua igual (revisão 1 vale integralmente):** itens 1, 2, 3, 5, 6, 7, 10, 11,
12, 13, 15, 16, 17, 19. Nenhum arquivo de dados, autorização ou configuração foi
tocado — `repo.ts`, `actions.ts`, `db.ts`, `(app)/layout.tsx` e `next.config.ts`
estão inalterados.

**Novo ou agravado:**

- Item 4 — o código de 6 dígitos é adivinhável por força bruta porque não há
  limite de tentativas.
- Item 8 — a confirmação de e-mail fechou o pre-hijacking pelo caminho da senha,
  mas o login Google continua contornando: **a falha segue aberta**, e agora é
  ela que faz uma conta não confirmada virar confirmada.
- Item 9 — sem endpoint de reenvio, um e-mail que falhe ou um código que expire
  deixa a conta permanentemente inacessível.
- Item 14 — regressão: `APP_URL` saiu da guarda de configuração do e-mail.
- Item 18 — regressão: o registro mobile perdeu a emissão de tokens.

---

## 1. 🔴 Dados financeiros são globais, sem escopo por usuário

**Onde:** `src/lib/repo.ts` (1615 linhas, 46 chamadas a `getDb()`), `src/lib/db.ts:427`

`repo.ts` não contém uma única referência a `userId`. Todas as 46 chamadas são
`getDb()` sem argumento, e `getDb()` sempre abre o mesmo arquivo:

```ts
// src/lib/db.ts:427
export function getDb(): DatabaseSync {
  assertFinanceStorageMode();
  return openDbAtPath(DB_PATH);   // sempre data/financeiro.db
}
```

O próprio schema confirma que o banco é monousuário: `accounts.name`,
`categories.name` e `income_sources.name` são `TEXT NOT NULL UNIQUE` — únicos
globalmente, não por usuário. Não existe coluna `user_id` em tabela nenhuma.

**Impacto:** qualquer usuário autenticado lê e escreve os lançamentos, contas,
cartões, faturas e metas de todos os outros. É vazamento total de dado financeiro
entre contas, e não há trilha para saber quem alterou o quê.

**Atenuante importante:** `assertFinanceStorageMode()` (`db.ts:44-57`) lança
exceção quando `NODE_ENV=production` ou `authConfigured()`, a menos que
`APP_ENV=staging` ou `ALLOW_UNSCOPED_FINANCEIRO_DB=true`. Ou seja: hoje a
aplicação **quebra** em produção em vez de vazar. A trava é fail-closed e está
certa — mas ela é o único motivo de isso não ser explorável, e o item 7 mostra
onde ela é contornada.

### ⛔ Por que este item continua aberto

O caminho escolhido foi o **A (PostgreSQL multi-tenant)**. Ele não foi executado
porque não há como validá-lo nesta máquina:

- Não existe Postgres disponível — `docker`, `psql` e `pg_ctl` não estão
  instalados, e `DATABASE_URL` não está configurada (`/api/health` responde 503).
- A migração não é mecânica: são 1615 linhas em `repo.ts`, 48 funções e 8 tabelas
  em dialeto SQLite (`datetime('now')`, `GLOB`, booleano como 0/1, placeholders
  `?`) que precisam virar Postgres, e todas as funções passam de **síncronas a
  assíncronas** — o que muda os ~11 `page.tsx` e as 27 actions que as consomem.
- A suíte de 23 testes (`scripts/test-lib.ts`, `test-fatura.ts`, `test-invoice.ts`,
  `test-amarracao.ts`) roda contra um arquivo SQLite. A migração a desliga, e é
  justamente ela que hoje protege o cálculo de fatura, parcelamento e projeção de
  contas.

Escrever essa tradução sem poder executar nenhuma linha dela, sobre a lógica
financeira que os testes cobrem, tem alta probabilidade de quebrar
funcionalidade que hoje funciona. Por isso o item ficou pendente em vez de ser
entregue às cegas.

**Para desbloquear, basta uma destas:**

1. Subir um Postgres e apontar `DATABASE_URL` para ele (Docker local, ou a
   instância de desenvolvimento do Azure). Com isso a migração é executável e
   testável de ponta a ponta.
2. Aceitar o **Caminho B** como etapa intermediária: um arquivo SQLite por
   usuário. Entrega o isolamento agora, é verificável com a suíte atual, e deixa
   a troca para Postgres como mudança de motor de armazenamento — não de API,
   porque as assinaturas já passariam a receber `userId`.

Enquanto nenhuma das duas acontecer, o que segura a falha é a trava
`assertFinanceStorageMode()`: em produção a aplicação **quebra em vez de vazar**.
É por isso que o item 7 (que desliga essa trava em staging) também ficou
pendente — removê-lo isolado só derrubaria staging sem entregar isolamento
nenhum. Os dois andam juntos.

**Correção.** Escolha um dos dois caminhos e execute inteiro — meio caminho é pior
que nenhum, porque desliga a trava sem entregar o isolamento.

*Caminho A — migrar o financeiro para o PostgreSQL que já existe (recomendado).*
Adicione `user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE` em
todas as tabelas financeiras, troque os `UNIQUE` globais por
`UNIQUE (user_id, name)`, e faça toda função do `repo.ts` receber `userId` como
primeiro parâmetro, com `WHERE user_id = $1` em cada consulta. Vantagem: um banco
só, backup único, e o `ON DELETE CASCADE` já resolve exclusão de conta.

*Caminho B — um arquivo SQLite por usuário.* O código já existe e está morto
(item 19): `getDbForUser(userId)` em `db.ts:411` e `resolveFinanceDbPath()` em
`db.ts:33` já resolvem `data/users/<id>/financeiro.db`. Basta o `repo.ts` passar
a receber o `userId` e usar `getDbForUser`. Mais rápido de entregar, mas não
escala em App Service (disco efêmero, sem consulta entre usuários).

Em qualquer dos dois, o padrão a seguir é o da própria doc do Next — a checagem
mora na camada de dados, não na página:

```ts
// src/lib/repo.ts — assinatura nova
export async function listAccounts(userId: string): Promise<Account[]> { /* ... */ }

// quem chama:
const userId = await requireCurrentUserId();   // lança se não houver sessão
const accounts = await listAccounts(userId);
```

Só remova `assertFinanceStorageMode()` depois que o escopo estiver de pé.

---

## 2. 🔴 Autorização feita só no layout não protege a rota

**Onde:** `src/app/(app)/layout.tsx:12-15`

```ts
const user = await currentUser();
if ((authConfigured() || process.env.NODE_ENV === "production") && !user) {
  redirect("/login");
}
```

Esse é o único ponto de autorização de `/carteiras`, `/cartoes`, `/contas`,
`/economia`, `/investimentos`, `/lancamentos` e `/relatorios`. Nenhuma dessas
páginas faz checagem própria (só `(app)/page.tsx` e `/configuracoes` chamam
`currentUser()`, e para exibir dados do perfil, não para barrar acesso).

A doc do Next 16 é explícita sobre por que isso não funciona
(`node_modules/next/dist/docs/01-app/02-guides/authentication.md`, linhas 1352-1354):

> Devido ao Partial Rendering, tenha cautela ao fazer checagens em Layouts, pois
> eles não re-renderizam a cada navegação (…). **Um layout também não controla se
> o resto da rota renderiza. Segmentos de rota e slots de rotas paralelas são
> renderizados pelo router, então um layout que esconde ou troca esses segmentos
> não impede que eles executem ou apareçam no RSC Payload.**

E, no mesmo guia (linha 1458), sobre bloquear no topo da árvore:

> Esse padrão **não é recomendado**, já que aplicações Next.js têm múltiplos
> pontos de entrada, o que não impede que segmentos de rota aninhados e Server
> Actions sejam acessados.

**Impacto:** o `redirect()` troca a navegação, mas os segmentos filhos já
executaram — a consulta ao banco rodou e o resultado vai no RSC Payload da
resposta. Um cliente que fala o protocolo RSC direto (um `fetch` com o header
`RSC: 1`) lê o payload sem nunca renderizar a tela de login.

**Correção.** Mantenha o `redirect` no layout para a experiência de navegação,
mas mova a *aplicação* da regra para a camada de dados — é a orientação da doc
("faça as checagens perto da sua fonte de dados"). Concretamente, o item 1 já
resolve isto: se toda função do `repo.ts` exige `userId` e o `userId` vem de
`requireCurrentUserId()`, uma requisição sem sessão lança antes de ler qualquer
linha. Adicione também a checagem no topo de cada `page.tsx` protegida:

```ts
// src/app/(app)/relatorios/page.tsx (e todas as outras)
const userId = await requireCurrentUserId();
```

Um `proxy.ts` na raiz pode fazer o redirect cedo e barato — mas apenas como
otimização. Note que em Next 16 `middleware.ts` foi **descontinuado e renomeado
para `proxy.ts`** (`docs/01-app/03-api-reference/03-file-conventions/middleware.md`),
e a doc avisa que proxy serve para "checagens otimistas", **não** como solução de
autorização (`docs/01-app/01-getting-started/16-proxy.md`, linha 29). Ele não
substitui nada acima.

---

## 3. 🔴 Server Actions sem checagem de sessão

**Onde:** `src/lib/actions.ts` — 27 Server Actions exportadas, apenas
`updateProfileAction` (linha 44) chama `currentUserId()`.

Ficam sem qualquer verificação, entre outras: `createTransactionAction`,
`deleteTransactionAction`, `commitBulkAction`, `createAccountAction`,
`deleteAccountAction`, `payBillAction`, `payCardInvoiceAction`,
`importInvoiceAction`, `createGoalAction`, `deleteGoalAction`.

Server Action é endpoint HTTP público — o `"use server"` gera uma rota com ID
estável que qualquer cliente pode chamar por POST. A doc trata isso como regra
(`authentication.md`, linha 1463):

> Trate Server Actions com as mesmas considerações de segurança de endpoints
> públicos, e verifique se o usuário tem permissão para executar a mutação.

**Impacto:** escrita e exclusão de dados financeiros sem autenticação nenhuma.
Combinado com o item 1 (dados globais), um POST anônimo apaga a conta bancária
de qualquer usuário.

**Nota sobre as mudanças desta revisão:** exigir e-mail confirmado no login não
alcança esse caminho. As Server Actions não passam pela rota de login — elas nem
consultam a sessão. Um atacante que nunca criou conta continua podendo chamá-las.

**Correção.** Uma linha no topo de cada action, antes de qualquer acesso a dado:

```ts
export async function deleteAccountAction(id: string): Promise<ActionResult> {
  const userId = await requireCurrentUserId();   // lança sem sessão
  // ... e repasse userId para o repo
}
```

Depois do item 1 isso fica redundante por construção (o repo exige `userId`),
mas mantenha explícito: a defesa em profundidade é o que protege a próxima action
que alguém escrever esquecendo do assunto.

---

## 4. 🟠 Código de confirmação de 6 dígitos sem limite de tentativas

**Onde:** `src/lib/auth-db.ts:430` (`createEmailVerification`), `:447` (`verifyEmail`),
`src/app/api/v1/auth/verify-email/route.ts`

```ts
const code = String(randomInt(100000, 1000000));   // 900.000 possibilidades
```

A geração está correta: `randomInt` é CSPRNG, a faixa é uniforme, o valor só é
guardado como `digest(email:code)`, o código anterior é apagado ao gerar outro, e
a conferência roda em transação com `FOR UPDATE`. O problema não é o código — é
que **nada conta tentativas**.

A tabela `email_verification_tokens` não tem coluna de tentativas, o
`verifyEmail()` não incrementa nada, e a rota não aplica nenhum limite. O item 5
confirma que não existe rate limiting em lugar nenhum do projeto.

**Impacto — força bruta viável:**

- Espaço de busca: 900.000 códigos. Acerto esperado em ~450.000 tentativas.
- Janela: 10 minutos (`EMAIL_VERIFICATION_TTL_SECONDS`).
- Custo por tentativa no servidor: uma consulta indexada por `token_hash`. Sem
  scrypt, sem trabalho pesado — é barata de propósito.
- Isso dá ~750 req/s sustentados para cobrir metade do espaço na janela. Com
  concorrência moderada, um atacante consegue isso de uma única máquina.

O alvo é uma conta recém-registrada cujo e-mail o atacante conheça. Confirmando o
e-mail da vítima, ele não obtém sessão diretamente — mas destrava o login, e o
código de confirmação deixa de ser barreira para o resto do fluxo.

**Correção.** Duas mudanças, ambas necessárias:

```sql
ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
```

```ts
// dentro de verifyEmail, na mesma transação — buscar pelo usuário, não pelo hash
const found = await client.query(
  `SELECT t.id, t.user_id, t.token_hash, t.attempts
     FROM email_verification_tokens t
     JOIN app_users u ON u.id = t.user_id
    WHERE u.email = $1 AND t.used_at IS NULL AND t.expires_at > now()
    FOR UPDATE OF t`,
  [email],
);
const row = found.rows[0];
if (!row) { await client.query("ROLLBACK"); return false; }

if (row.attempts >= 5) {
  // queima o código: o usuário pede outro (item 9)
  await client.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [row.id]);
  await client.query("COMMIT");
  return false;
}

const ok = timingSafeEqual(
  Buffer.from(row.token_hash, "hex"),
  Buffer.from(digest(`${email}:${code}`), "hex"),
);
if (!ok) {
  await client.query(`UPDATE email_verification_tokens SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  await client.query("COMMIT");
  return false;
}
```

Note que a busca passa a ser pelo e-mail (não pelo hash do código), porque só
assim dá para contar tentativas erradas — hoje um código errado simplesmente não
casa com linha nenhuma e nada é registrado. Some a isso o rate limiting do item 5
sobre `/verify-email`, e considere subir o código para 8 dígitos.

---

## 5. 🟠 Zero rate limiting

**Onde:** `src/app/api/v1/auth/login`, `/register`, `/forgot-password`,
`/reset-password`, `/verify-email`. Uma busca por `rateLimit|throttle` em todo o
`src/` não retorna nada.

**Impacto:**
- **Força bruta do código de confirmação** — é o que torna o item 4 explorável.
- **Força bruta de senha** ilimitada no `/login`.
- **Bomba de e-mail / custo**: `/forgot-password` e `/register` disparam Resend a
  cada chamada. Sem limite, é abuso de custo e assédio contra um e-mail alvo.
- **DoS por CPU**: cada `/login` e cada `/register` roda scrypt (proposital e
  caro). Requisições concorrentes com senha qualquer travam o event loop.

**Correção.** Limite por IP **e** por conta alvo, com resposta 429:

```ts
// src/lib/rate-limit.ts
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
```

Sugestão de orçamento: `verify-email` 10/h por e-mail e 30/h por IP; login 5/min
por IP e 10/h por e-mail; forgot-password 3/h por e-mail; register 5/h por IP.
Em memória resolve para uma instância só; se o App Service escalar
horizontalmente, mova o contador para uma tabela no Postgres (`app_rate_limits`)
ou para Redis, senão cada instância conta sozinha.

---

## 6. 🟠 TLS do Postgres não valida certificado

**Onde:** `src/lib/auth-db.ts:32`

```ts
ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
```

`rejectUnauthorized: false` aceita qualquer certificado — inclusive autoassinado
por um atacante. A conexão continua cifrada, mas sem autenticação do servidor,
o que é precisamente o que TLS deveria garantir.

**Impacto:** quem estiver na rota entre o App Service e o Postgres (rede Azure
comprometida, DNS envenenado, proxy malicioso) termina a conexão, lê e altera
todo o tráfego: hashes de senha, tokens de sessão, códigos de confirmação, dados
pessoais. É o pior caminho de comprometimento total do banco.

**Correção.** Use a CA do provedor. O Azure Database for PostgreSQL usa a raiz
DigiCert Global Root G2:

```ts
import { readFileSync } from "node:fs";

ssl: process.env.DATABASE_SSL === "false"
  ? false
  : {
      rejectUnauthorized: true,
      ca: process.env.DATABASE_CA_CERT
        ?? readFileSync("./certs/DigiCertGlobalRootG2.crt.pem", "utf8"),
    },
```

Mantenha `DATABASE_SSL=false` só para o Postgres local de desenvolvimento.

---

## 7. 🟠 A trava do banco compartilhado é desligada em staging

**Onde:** `src/lib/db.ts:44-57`

```ts
const isStagingAppService =
  process.env.WEBSITE_SITE_NAME?.startsWith("girofin-staging-") === true;

if (
  (process.env.NODE_ENV === "production" || authConfigured()) &&
  process.env.APP_ENV !== "staging" &&
  !isStagingAppService &&
  process.env.ALLOW_UNSCOPED_FINANCEIRO_DB !== "true"
) { throw new Error(/* ... */); }
```

`WEBSITE_SITE_NAME` é definido pelo **Azure App Service**, não pela aplicação.
Qualquer slot cujo nome comece com `girofin-staging-` desativa a proteção do
item 1 — e passa a rodar com autenticação real (`authConfigured()`) sobre um
banco financeiro **único e compartilhado**.

**Impacto:** staging normalmente tem usuários reais testando com dados reais.
Nesse ambiente o item 1 deixa de ser teórico e vira vazamento efetivo entre
contas. `APP_ENV=staging` tem o mesmo efeito e é ainda mais fácil de acabar
copiado para o slot de produção numa troca de configuração.

**Correção.** Remova as duas exceções. Se staging precisa de dados de brinquedo,
resolva com um banco de staging populado com dados sintéticos — não relaxando o
isolamento entre usuários. A trava deve depender de uma única variável explícita,
nunca de nome de host:

```ts
if (process.env.ALLOW_UNSCOPED_FINANCEIRO_DB !== "true") {
  throw new Error("Armazenamento financeiro compartilhado desativado.");
}
```

---

## 8. 🟠 O login Google contorna a confirmação de e-mail

**Onde:** `src/lib/auth-db.ts:229` e `:236`

A confirmação de e-mail adicionada nesta revisão fecha o pre-hijacking pelo
caminho da senha — mas `findOrCreateGoogleUser` continua exatamente como estava, e
é justamente ele que reabre o buraco:

```sql
FROM app_users WHERE google_subject = $1 OR email = $2 LIMIT 1
```

```sql
UPDATE app_users SET google_subject = $1,
       email_verified_at = COALESCE(email_verified_at, now()), name = $2
```

O `OR email` vincula um login Google a qualquer conta local com o mesmo e-mail —
**inclusive uma conta nunca confirmada** — e o `COALESCE(email_verified_at, now())`
marca essa conta como confirmada.

**Cenário de ataque (revisado para o fluxo atual):**
1. O atacante registra `vitima@gmail.com` com uma senha que ele escolhe. A conta
   nasce com `email_verified_at = NULL`. Ele **não** consegue confirmar nem entrar
   — até aqui a mudança desta revisão funcionou.
2. A conta fica lá, dormente, com a senha do atacante.
3. A vítima, dona real do endereço, entra com "Continuar com Google".
4. `findOrCreateGoogleUser` acha a conta do atacante pelo `OR email`, anexa o
   `google_subject` da vítima e — pelo `COALESCE` — **carimba a conta como
   confirmada**.
5. A vítima usa o app normalmente. O atacante agora entra por
   `POST /login` com a senha que ele mesmo cadastrou: as credenciais batem e o
   `emailVerified` passa. Ele lê todo o financeiro dela.

Ou seja: a vítima é quem confirma a conta do atacante, sem saber. O tratamento do
Google em si está correto — `aud`, `iss` e `email_verified` são todos validados no
callback. A falha está no vínculo local por e-mail não comprovado.

**Correção.** Só vincule a e-mails já comprovados:

```sql
WHERE google_subject = $1
   OR (email = $2 AND email_verified_at IS NOT NULL)
```

E decida o que fazer quando existir conta não confirmada com o mesmo e-mail. O
caminho seguro é **descartar a conta pendente** (o atacante nunca provou o
endereço; quem chegou pelo Google provou) e criar a conta do Google limpa:

```ts
await getPool().query(
  `DELETE FROM app_users WHERE email = $1 AND email_verified_at IS NULL AND google_subject IS NULL`,
  [email],
);
```

Faça isso na mesma transação da criação. Alternativa mais conservadora: mantenha a
conta e exija a senha antes de vincular — mas aí a vítima precisa de uma senha que
ela nunca cadastrou, o que na prática é um bloqueio.

---

## 9. 🟠 Conta órfã permanente: não existe reenvio de código

**Onde:** `src/app/api/v1/auth/register/route.ts:17-20`

```ts
const user = await registerUser(body);              // 1. cria o usuário
const verification = await createEmailVerification(user.id);  // 2. gera o código
await sendEmailVerification(verification);          // 3. envia — pode lançar
```

Se o passo 3 falhar (Resend fora do ar, cota estourada, `RESEND_API_KEY` errada,
domínio não verificado), o `throw` cai no `catch` e vira 503 — mas **o usuário do
passo 1 já foi gravado**. O mesmo vale para o caso trivial de o código expirar em
10 minutos antes de a pessoa abrir o e-mail.

A partir daí a conta está morta e não há saída:

- `POST /register` de novo → 409 `EMAIL_ALREADY_REGISTERED`.
- `POST /login` → 403 `EMAIL_NOT_VERIFIED`.
- `POST /verify-email` → não há código válido para informar.
- **Não existe rota de reenvio.** `createEmailVerification` só é chamada de
  `register`, e o `auth-form.tsx` não tem botão de reenviar.

**Impacto:** indisponibilidade permanente por conta afetada, sem autoatendimento.
Em produção isso vira fila de suporte e, pior, pressão para "resolver no banco" —
edição manual de `email_verified_at`, que é exatamente o tipo de intervenção que
gera incidente. Uma falha transitória do Resend basta para derrubar todos os
cadastros da janela.

**Correção.** Duas coisas:

*Uma rota de reenvio*, respondendo sempre igual para não enumerar contas
(item 15) e com rate limiting do item 5:

```ts
// src/app/api/v1/auth/resend-verification/route.ts
const schema = z.object({ email: z.string().trim().email().max(254) });

export async function POST(request: Request) {
  const { email } = schema.parse(await request.json());
  const pending = await findUnverifiedUserByEmail(email);   // nova função no auth-db
  if (pending) {
    const verification = await createEmailVerification(pending.id);
    await sendEmailVerification(verification);
  }
  return apiSuccess({ message: "Se houver cadastro pendente, enviamos um novo código." });
}
```

`createEmailVerification` já apaga o código anterior não usado, então o reenvio é
idempotente. Adicione o botão correspondente na tela de confirmação do
`auth-form.tsx`.

*Não deixe usuário criado sem e-mail enviado.* Envolva os passos 1 e 2 numa
transação e só faça `COMMIT` depois que o envio retornar — ou, se preferir não
segurar transação em I/O de rede, apague o usuário no `catch` quando o envio
falhar.

---

## 10. 🟡 `AUTH_SECRET` com fallback hardcoded

**Onde:** `src/lib/auth-db.ts:112`

```ts
return createHmac("sha256", process.env.AUTH_SECRET ?? "development-only-secret")
```

Essa chave protege o hash de **todos** os tokens: sessão, access token, refresh
token, reset de senha e — novo nesta revisão — o código de confirmação de e-mail.
O fallback está no repositório, legível por qualquer um.

Hoje `authConfigured()` exige `AUTH_SECRET` e `ensureAuthSchema()` recusa subir
sem ele, então o fallback não é alcançável pelos caminhos atuais. O problema é
que a proteção é indireta: um refactor que chame `digest()` fora desse fluxo
reintroduz a falha em silêncio, e nada avisa.

**Impacto (se alcançado):** o atacante calcula
`HMAC-SHA256("development-only-secret", "email:código")` para os 900.000 códigos
possíveis, ou forja o hash de uma sessão qualquer, e entra como qualquer usuário.

**Correção.** Falhe no boot, sem fallback:

```ts
function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres).");
  }
  return secret;
}

function digest(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("hex");
}
```

---

## 11. 🟡 Cookie de sessão e access token são a mesma coisa

**Onde:** `src/lib/auth-db.ts:287` (`getUserByAccessToken`) vs `:197` (`getUserBySession`)

As duas funções consultam a **mesma tabela** `app_sessions`, com a mesma condição.
Não existe coluna que distinga o tipo do token. Consequências:

- O valor do cookie web (TTL de 30 dias) funciona como `Authorization: Bearer`.
- O access token mobile (TTL de 15 min) funciona como cookie de sessão web.
- `revokeAllSessions()` no logout mobile derruba também as sessões web do usuário —
  hoje o `/logout` faz exatamente isso ao receber um Bearer.

**Impacto:** as TTLs distintas viram ficção. Um token que vazou de um contexto
(log de proxy, storage do app, histórico de URL) é aceito no outro, e o raio de
alcance de qualquer vazamento cresce. É também a razão de o logout no celular
deslogar o usuário no navegador.

**Correção.** Adicione o tipo e filtre por ele:

```sql
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'web'
  CHECK (kind IN ('web','mobile_access'));
```

```ts
// getUserBySession:      WHERE s.token_hash = $1 AND s.kind = 'web' AND s.expires_at > now()
// getUserByAccessToken:  WHERE s.token_hash = $1 AND s.kind = 'mobile_access' AND s.expires_at > now()
```

E faça `revokeAllSessions` receber o escopo, para o logout mobile não derrubar a
sessão do navegador.

---

## 12. 🟡 Nenhum header de segurança

**Verificado no servidor rodando:**

```
$ curl -sI http://127.0.0.1:3000/login | grep -iE "strict-transport|x-frame|content-security"
X-Powered-By: Next.js
```

Nenhum `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy` ou `Permissions-Policy`. E o
`X-Powered-By` entrega framework e superfície de ataque de graça.

**Impacto:** sem CSP, qualquer XSS futuro tem execução livre e exfiltração livre.
Sem `X-Frame-Options`/`frame-ancestors`, a aplicação pode ser embutida em iframe
(clickjacking sobre botões de pagamento e exclusão). Sem HSTS, a primeira visita
em HTTP é sequestrável — e agora ela pode carregar um código de confirmação.

**Correção.** Em `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: [
            "default-src 'self'",
            "img-src 'self' data: https:",      // data: é necessário para o avatar
            "style-src 'self' 'unsafe-inline'", // Tailwind injeta estilo inline
            "script-src 'self'",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; ") },
      ],
    }];
  },
};
```

### ⚠️ Ressalva do que foi aplicado

Os 6 headers estão ativos e `X-Powered-By` sumiu — verificado contra o build de
produção. Mas a CSP aplicada usa `script-src 'self' 'unsafe-inline'`, e
`'unsafe-inline'` em `script-src` **enfraquece muito** a proteção contra XSS: um
script injetado na página ainda executa.

O motivo é que o App Router injeta scripts inline para transmitir o RSC Payload
(`self.__next_f.push`). Sem `'unsafe-inline'` nem nonce, o app não carrega.

**Como fechar de verdade:** gerar um nonce por requisição em `proxy.ts` e
repassá-lo na CSP, trocando `'unsafe-inline'` por `'nonce-<valor>'`. Enquanto
isso não é feito, o valor real desta CSP está em `frame-ancestors`, `base-uri`,
`form-action`, `object-src` e `connect-src` — que já são efetivos.

---

## 13. 🟡 `resetToken` devolvido na resposta fora de produção

**Onde:** `src/app/api/v1/auth/forgot-password/route.ts:16`

```ts
if (process.env.NODE_ENV !== "production" && reset) response.resetToken = reset.token;
```

Quando `NODE_ENV` não é `production`, o endpoint devolve o token de recuperação
direto no corpo da resposta — para qualquer um que peça, sobre qualquer e-mail.
É takeover de conta em uma requisição.

**Verificado:** o `.next/standalone/server.js` fixa `process.env.NODE_ENV = 'production'`
na linha 5, então **`npm start` não é vulnerável**. O risco real é qualquer
ambiente que não passe por esse arquivo: um `next dev` exposto na rede, um
container que rode `next start` com `NODE_ENV` sobrescrito, ou um deploy que não
use o build standalone.

Note ainda que o `if (... && reset)` faz o campo aparecer **só quando o e-mail
existe** — o que transforma a resposta num oráculo de enumeração de contas mesmo
para quem não quer o token.

**Correção.** Tire o token da resposta HTTP. Em desenvolvimento, mande para o log
do servidor — que é o padrão que o `auth-email.ts` já usa para o código de
confirmação, e está certo lá:

```ts
if (process.env.NODE_ENV !== "production" && reset) {
  console.info("[dev] link de reset:", `${process.env.APP_URL}/redefinir-senha?token=${reset.token}`);
}
```

---

## 14. 🟡 `APP_URL` deixou de ser validado — link de reset quebrado

**Onde:** `src/lib/auth-email.ts:13` (regressão desta revisão)

A guarda mudou de `if (!appUrl || !apiKey || !from)` para:

```ts
if (!apiKey || !from) {
```

`appUrl` saiu da condição, mas continua sendo usado no corpo do e-mail (linha 36):

```ts
`${appUrl}/redefinir-senha?token=${input.token}\n\n`
```

**Impacto:** com `RESEND_API_KEY` e `EMAIL_FROM_NO_REPLY` configurados mas
`APP_URL` ausente, o e-mail **é enviado** com o link
`undefined/redefinir-senha?token=…`. O usuário recebe um link quebrado, e o token
— que é de uso único e vale 1 hora — é gasto sem que ninguém consiga usá-lo. A
recuperação de senha fica inutilizável sem nenhum erro no servidor.

Provavelmente a intenção era só permitir que `sendEmailVerification` funcionasse
sem `APP_URL` (ele manda um código, não um link) — o que é correto. O erro foi
relaxar a guarda da função que ainda precisa da variável.

**Correção.** Cada função valida o que usa:

```ts
// sendPasswordResetEmail — precisa de APP_URL
if (!apiKey || !from || !appUrl) { /* ... */ }

// sendEmailVerification — não precisa, e já está certo assim
if (!apiKey || !from) { /* ... */ }
```

Vale também validar `APP_URL` no boot, junto com `AUTH_SECRET` (item 10).

---

## 15. 🟡 Enumeração de contas

**Três caminhos hoje:**

*Registro* (`register/route.ts:26`): responde `409 EMAIL_ALREADY_REGISTERED`
quando o e-mail existe. Confirma cadastro de forma inequívoca.

*Login* (`auth-db.ts:177`): `if (!user || !(await verifyPassword(...)))`. Com
e-mail inexistente a função retorna na hora; com e-mail existente ela roda scrypt
antes. A diferença de tempo é de ordens de grandeza e mede-se sem esforço.

*Forgot-password* fora de produção: o campo `resetToken` só aparece quando o
e-mail existe (item 13).

**Impacto:** o atacante monta a lista de quem tem conta antes de gastar tentativas
de senha — e, num app financeiro, a própria lista de clientes já é dado sensível.
O 403 `EMAIL_NOT_VERIFIED` do login novo não piora isso (ele só aparece depois de
a senha bater, quando o atacante já sabe que a conta existe).

**Correção.** No login, sempre execute o scrypt:

```ts
const DUMMY_HASH = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);

const user = result.rows[0];
const stored = user?.password_hash ?? DUMMY_HASH;
const valid = await verifyPassword(password, stored);   // custo constante
if (!user || !valid) return null;
```

No registro, a decisão é de produto. Agora que existe confirmação por e-mail, o
caminho seguro ficou natural: responda **sempre** 201 com a mesma mensagem
("enviamos um código para o seu e-mail") e diferencie no e-mail — código novo se
a conta não existia, aviso "você já tem conta, faça login" se existia. O atacante
não distingue os casos; o dono do e-mail sim.

---

## 16. 🔵 `importInvoiceAction` sem validação nem limite

**Onde:** `src/lib/actions.ts:507`

Recebe `linhas: Array<{...}>` direto do cliente, sem schema Zod (diferente das
rotas de API, que validam) e sem teto de tamanho. O laço grava uma transação por
item. Sem autenticação (item 3), um POST com 10 milhões de linhas escreve até o
disco encher ou o processo cair.

**Correção.** Valide e limite, como já é feito nas rotas de auth:

```ts
const linhasSchema = z.array(z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(-100_000_000).max(100_000_000),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().min(1).max(64),
  installmentNo: z.number().int().min(1).max(99).nullable(),
  installmentTotal: z.number().int().min(1).max(99).nullable(),
})).min(1).max(500);
```

---

## 17. 🔵 Avatar de até 2,8 MB relido a cada validação de sessão

**Onde:** `src/lib/auth-db.ts` — `getUserBySession` e `getUserByAccessToken`
incluem `u.avatar_data_url` no `SELECT`.

Toda navegação autenticada puxa até 2,8 MB de base64 do Postgres só para validar
a sessão. Não é falha de segurança, mas é vetor de degradação barato: alguns
usuários com avatar no limite saturam a banda do banco.

**Correção.** Tire o avatar do `SELECT` de sessão e carregue sob demanda em
`/configuracoes`. Melhor ainda: guarde a imagem no Blob Storage e salve só a URL.

---

## 18. 🔵 Registro mobile deixou de funcionar

**Onde:** `src/app/api/v1/auth/register/route.ts:11` (regressão desta revisão)

O schema ainda aceita `client: z.enum(["web", "mobile"])`, mas o handler não usa
mais o campo: a chamada a `createMobileSession()` foi removida junto com o
`setAuthSession()`. Um app mobile que envie `client: "mobile"` recebe 201 sem
`accessToken` nem `refreshToken`.

Não é falha de segurança — pelo contrário, não emitir sessão antes da confirmação
está correto. Mas o contrato da API mudou em silêncio, e o `client` virou um campo
aceito e ignorado, que é o tipo de coisa que engana quem for integrar depois.

**Correção.** Decida o fluxo mobile: ou o app confirma o e-mail e depois chama
`/login` (então remova `client` do schema de registro e documente no OpenAPI), ou
`/verify-email` passa a devolver a sessão mobile quando `client: "mobile"` for
enviado ali. Atualize `src/app/api/openapi.json/route.ts` de qualquer forma — ele
ainda descreve o contrato antigo.

---

## 19. 🔵 Código morto de escopo dá falsa sensação de segurança

`src/lib/finance-user.ts` inteiro (`resolveFinanceDbPathForUser`,
`requireFinanceUserScope`) **nunca é importado** — a busca por `finance-user` no
`src/` não retorna nada. `getDbForUser` (`db.ts:411`) e `getDbForCurrentUser`
(`db.ts:418`) também não têm nenhum chamador.

O comentário do `db.ts:26` descreve a intenção — "a próxima etapa da migração
multiusuário será exigir um `user_id` da sessão" — mas quem lê rápido conclui que
o escopo por usuário já existe. Ele não existe: nada disso está ligado.

**Correção.** Ao executar o item 1, ligue essas funções de verdade (é o Caminho B)
ou apague-as. Enquanto ficarem soltas, elas escondem a falha crítica.

---

## 20. 🟠 O e-mail de recuperação de senha nunca era enviado

**Achado durante a aplicação das correções.**

`sendPasswordResetEmail()` existia em `src/lib/auth-email.ts` desde sempre, mas
**nenhum código a chamava**. A rota `/api/v1/auth/forgot-password` apenas gravava
o token e respondia "você receberá as instruções" — mensagem que nunca se
cumpria em produção.

Em desenvolvimento a falha ficava escondida pelo item 13: o token voltava no
corpo da resposta, então o fluxo parecia funcionar. Em produção, onde esse campo
não aparece, o usuário ficava sem nenhum caminho para recuperar a conta.

**Corrigido:** a rota agora chama `sendPasswordResetEmail()` quando existe
cadastro, e a guarda de configuração do item 14 garante que o link do e-mail não
saia quebrado.

---

## Configuração de infraestrutura (Azure)

Achados de ambiente, verificados por leitura das App Settings e por sondagem dos
endpoints. Não são falhas de código — nenhum deles se resolve no repositório.

### I1. 🔴 `DATABASE_URL` sem host, nos dois ambientes

O valor tem a forma `postgresql://<credencial>@/<banco>?sslmode=require`: o `@`
é seguido direto por `/`, sem o nome do servidor. Confirmado em
`girofin-prod-1704` (84 chars) e `girofin-staging-1704` (87 chars).

Sem host, o driver não chega ao Postgres do Azure — cai no padrão local, que no
App Service não existe. Nenhuma conexão vai funcionar enquanto isso não for
corrigido, independente de qualquer outra configuração.

O servidor correto é `girofin-db-prod-1704.postgres.database.azure.com`
(PostgreSQL 16, Ready, acesso público habilitado). O valor precisa ficar:

```
postgresql://<usuario>:<senha>@girofin-db-prod-1704.postgres.database.azure.com/girofin_prod?sslmode=require
```

E o equivalente com `girofin_staging` no outro ambiente. Os dois bancos já
existem no servidor.

### I2. 🔴 `AUTH_SECRET` vazia em produção, ausente em staging

Em produção a chave existe com **valor vazio**; em staging não existe. Como
`authConfigured()` é `Boolean(DATABASE_URL && AUTH_SECRET)`, a autenticação fica
desligada nos dois — `/api/health` responde `{"ok":false}` e qualquer rota de
auth devolve 503.

Atenção ao preencher: o código passou a exigir **no mínimo 32 caracteres**
(item 10). Com menos, a aplicação lança no boot em vez de usar um segredo fraco.

### I3. 🟠 A mesma chave do Resend nos dois ambientes

`RESEND_API_KEY` tem 36 caracteres, prefixo `re_` e o mesmo final nos dois App
Services — é a mesma credencial. Três consequências:

- Teste em staging dispara e-mail real saindo de `no-reply@girofin.com.br` para
  caixas reais.
- Um vazamento pelo ambiente menos protegido permite enviar mensagem assinada
  pelo domínio, e a única reação (revogar a chave) derruba produção junto.
- Bounce e denúncia de spam gerados em staging contam contra a reputação que
  produção usa para entregar código de confirmação.

Gere uma chave por ambiente. Idealmente verifique um subdomínio separado para
staging, para que nem a reputação seja compartilhada.

### I4. 🟡 Staging sem as variáveis de autenticação

Faltam `AUTH_SECRET`, `APP_URL`, `APP_ENV`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI`. Sem `APP_URL`, quando a
autenticação subir, `sendPasswordResetEmail` e `sendAccountExistsEmail` vão
recusar o envio pela guarda do item 14 — o e-mail de código de confirmação
funciona (não usa link), o de recuperação de senha não.

### I5. 🟡 Firewall do Postgres só libera serviços do Azure

A única regra é `AllowAllAzureServicesAndResourcesWithinAzureIps`
(`0.0.0.0 → 0.0.0.0`). O App Service alcança o banco; nenhuma máquina de
desenvolvimento alcança. Verificado: DNS resolve
(`20.226.33.134`), mas a porta 5432 não responde daqui.

Isso é o que mantém o **item 1 bloqueado**: a migração multi-tenant precisa de
um Postgres alcançável para ser desenvolvida e testada. Uma regra de firewall
para o IP público da máquina de desenvolvimento, apontando para
`girofin_staging`, destrava.

### I6. ⚠️ O código corrigido não está publicado

Sondagem do App Service de produção: `X-Powered-By: Next.js` ainda presente e
sem nenhum header de segurança (é o `next.config.ts` antigo), e
`POST /api/v1/auth/resend-verification` responde 404. Nenhuma das correções
deste documento está no ar.

**Consequência prática:** no build publicado, `sendPasswordResetEmail()` nunca é
chamado (item 20). Testar `/recuperar-senha` em produção hoje grava o token,
mostra a mensagem de sucesso e não envia e-mail nenhum — o painel do Resend fica
vazio, e o sintoma aparenta problema de DNS ou de provedor quando é código.

### Ordem que funciona

1. Corrigir `DATABASE_URL` nos dois ambientes (I1).
2. Definir `AUTH_SECRET` com 32+ caracteres nos dois (I2).
3. Completar as variáveis de staging (I4) e separar a chave do Resend (I3).
4. Publicar o código corrigido (I6).
5. Só então testar cadastro, confirmação de e-mail e recuperação de senha.

Antes do passo 2, tenha em conta o que a trava restaurada significa: com
`ALLOW_UNSCOPED_FINANCEIRO_DB=false` e a autenticação funcionando, toda tela
financeira vai lançar até o item 1 estar pronto. É o comportamento desejado —
quebrar em vez de vazar — mas transforma o item 1 no bloqueador de lançamento.

---

## Ordem sugerida de execução

**Antes de qualquer usuário real entrar:** itens 1, 2 e 3 — são a mesma falha
vista de três ângulos, e nenhum dos outros importa enquanto o dado for global.
Comece pelo 1 (o escopo no repo), porque 2 e 3 caem por consequência quando toda
leitura exige `userId`.

**No mesmo ciclo — fecham o fluxo de cadastro que você acabou de abrir:** 4 e 5
(sem limite de tentativas o código de 6 dígitos não protege nada), 8 (o Google
ainda contorna a confirmação inteira) e 9 (hoje uma falha do Resend mata a conta
para sempre). Junto com esses, 7 (a exceção de staging anula a única trava que
existe) e 6 (uma linha, risco alto).

**Regressões rápidas, corrija junto:** 14 e 18 — são poucos minutos cada.

**Antes de abrir ao público:** 10, 11, 12, 13, 15.

**Quando der:** 16, 17, 19.

---

## Como reproduzir a auditoria

```bash
npm audit                                   # dependências: 0 vulnerabilidades
npm run build && npm start                  # sobe o standalone
curl -sI http://127.0.0.1:3000/login        # headers (item 12)
grep -c "userId" src/lib/repo.ts            # 0 -> item 1
grep -c "^export async function" src/lib/actions.ts   # 27
grep -n "currentUserId" src/lib/actions.ts  # import + 1 uso -> item 3
grep -rn "rateLimit\|throttle" src/         # vazio -> itens 4 e 5
grep -n "attempts" src/lib/auth-db.ts       # vazio -> item 4
grep -rn "resend-verification" src/         # vazio -> item 9
```

Referências de framework citadas (versão instalada, 16.3.4):

- `node_modules/next/dist/docs/01-app/02-guides/authentication.md` — linhas 1350-1360, 1458, 1463
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md` — descontinuação em favor de `proxy.ts`
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` — linha 29

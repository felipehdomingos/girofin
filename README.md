# GiroFin

Lan?amento di?rio de gastos com categoriza??o autom?tica, contas a pagar e
boletos, proje??o de investimentos com taxas reais do Banco Central, e um motor
de recomenda??o que aponta onde d? para economizar.

Reposit?rio: `felipehdomingos/girofin`

O fluxo financeiro principal continua rodando local em SQLite
(`data/financeiro.db`). A camada de identidade e a API de autentica??o ficam
habilitadas quando `DATABASE_URL` e `AUTH_SECRET` s?o configurados; at? a
migra??o global para multiusu?rio, os dados financeiros continuam no arquivo
local e n?o dependem de PostgreSQL.

---

## Come?ando

```bash
npm install
cp .env.example .env.local    # opcional para autentica??o e e-mail
npm run dev                   # http://localhost:3000
```

O banco financeiro ? criado sozinho na primeira execu??o, j? com as tabelas e o
vocabul?rio de categoriza??o. A autentica??o depende do PostgreSQL e das
vari?veis de ambiente do auth; quando elas n?o estiverem definidas, o app sobe
sem a camada de login.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (`next dev --webpack`) |
| `npm run build` | Build de produ??o |
| `npm start` | Roda o build em standalone |
| `npm test` | 44 testes das regras de neg?cio (dinheiro, datas, juros, categoriza??o) |
| `npm run typecheck` | Checagem de tipos |
| `npm run db:apply` | Cria/aplica o schema PostgreSQL para autentica??o |

### API e autentica??o

A documenta??o da API est? dispon?vel em runtime em:

- `/api/health`
- `/api/docs`
- `/api/openapi.json`
- `/api/v1/auth/register`
- `/api/v1/auth/login`
- `/api/v1/auth/logout`
- `/api/v1/auth/forgot-password`
- `/api/v1/auth/reset-password`
- `/api/v1/me`

Esses endpoints usam cookie HttpOnly e exigem `DATABASE_URL` e `AUTH_SECRET`
configurados. O banco financeiro continua em SQLite local; a camada de sess?o e
cadastro fica no PostgreSQL at? o projeto migrar completamente para o modelo
multiusu?rio.

---

## O dia a dia: lan?amento r?pido

Na tela **Lan?ar**, escreva o dia inteiro em texto corrido:

```
padaria sao joao 18,50
99 pop 23
carrefour compras do mes 342,80
netflix 39,90
+salario 5400
```

`Ctrl + Enter` interpreta. O app separa descri??o e valor, identifica a
categoria e mostra o que entendeu **antes** de salvar.

Regras do formato:

- **Um lan?amento por linha** (ou separados por `;`)
- **O valor ? o ?ltimo n?mero da linha** ? por isso `99 pop 23` funciona:
  descri??o "99 pop", valor R$ 23,00
- **`+` no come?o marca entrada.** Sem ele, ? sa?da
- Aceita `1.234,56`, `1234,56`, `1234.56`, `R$ 89,90` e `89`

### Como a categoriza??o funciona

100% local e determin?stico ? sem chamada a nenhuma API de IA. Tr?s raz?es:
lan?ar gasto ? opera??o de todo dia e n?o pode depender de rede; extrato ? dado
sens?vel e n?o precisa sair da m?quina; e o mesmo texto tem que cair sempre na
mesma categoria, sen?o o hist?rico fica incompar?vel.

O acerto vem de duas fontes:

1. **Vocabul?rio embutido** ? ~150 termos e marcas reais (`ifood`, `uber`,
   `carrefour`, `netflix`, `drogaria`...), porque ? assim que a despesa aparece
   no extrato e na mem?ria de quem digita.
2. **O que voc? ensina** ? quando voc? corrige um palpite, o app grava a regra.
   Corrigir uma vez ensina para sempre, e regra aprendida tem peso maior que a
   embutida.

Palpite com confian?a baixa vem destacado em ?mbar e a linha diz **por qual
palavra** ele reconheceu ? para voc? poder discordar com base em algo.

---

## As telas

| Tela | Responde |
|---|---|
| **Resumo** | Como estou este m?s? Entradas, sa?das, e o "livre de verdade" |
| **Lan?ar** | Registrar o dia + lista do m?s com busca e filtro |
| **Contas** | O que tenho para pagar? Contas fixas e boletos, com vencimento e quita??o |
| **Investir** | Quanto meu dinheiro vira? Proje??o com CDI/Selic/poupan?a reais |
| **Economizar** | Onde estou perdendo dinheiro? Diagn?stico com valores e a??es |

### "Livre de verdade"

O n?mero mais ?til do resumo. N?o ? o saldo ? ? o saldo **menos as contas ainda
em aberto**. A diferen?a entre achar que pode gastar e poder de fato.

### Contas fixas e boletos

Mesma tela para os dois, porque a pergunta ? a mesma ("o que eu tenho pra
pagar?"):

- **Conta fixa** ? volta todo m?s num dia do vencimento (aluguel, luz, internet)
- **Boleto avulso** ? data ?nica (IPVA, matr?cula, parcela)

Marque uma conta como **vari?vel** (luz, ?gua, cart?o) e o valor cadastrado
passa a ser tratado como estimativa. Na hora de quitar, o campo vem preenchido
com o previsto para voc? corrigir ? o que entra no hist?rico ? o valor que
realmente saiu, nunca o estimado.

Guarda a linha digit?vel opcionalmente, s? para copiar na hora de pagar.

### Taxas do Banco Central

V?m da API p?blica SGS: Selic (s?rie 432), CDI (4389) e IPCA (433, acumulado
de 12 meses por composi??o, n?o por soma).

Resili?ncia em tr?s camadas: cache local de 12h ? API ? constante de emerg?ncia.
**A tela sempre diz qual camada est? sendo usada.** Taxa desatualizada
apresentada como atual, numa ferramenta de decis?o financeira, ? pior que
nenhuma taxa.

### Motor de recomenda??o

Cada conselho carrega um **n?mero** e uma **a??o**. "Cuidado com gastos" n?o muda
comportamento; "corte R$ 189,30 em Restaurantes ? isso vira R$ 15.918 em 5 anos"
muda.

O que ele detecta: contas vencidas, m?s no vermelho, desvios da regra 50/30/20,
estouro de or?amento por categoria, saltos de gasto m?s a m?s, peso dos gastos
recorrentes, e reserva de emerg?ncia abaixo de 6 meses de custo.

---

## Decis?es t?cnicas

### Dinheiro ? inteiro, em centavos

Nunca `float`. `0.1 + 0.2` d? `0.30000000000000004` em qualquer linguagem com
IEEE-754; somando centenas de lan?amentos por ano, esse erro vira diferen?a
vis?vel no fechamento do m?s. Convers?o para texto s? na borda de renderiza??o
(`src/lib/money.ts`).

### Datas s?o string `"YYYY-MM-DD"`, nunca `Date`

`new Date("2026-03-01")` ? lido como UTC meia-noite. Em UTC-3 isso vira 28/02
?s 21h local ? o lan?amento do dia 1? cai no m?s anterior e o fechamento sai
errado. String pura n?o tem fuso (`src/lib/dates.ts`).

### O sinal mora no `type`, n?o no valor

Todo `amountCents` ? positivo, com `CHECK (amountCents > 0)` no banco. Guardar
despesa como negativo duplicaria a fonte de verdade e faria toda soma depender
de saber qual conven??o foi usada.

### Contas a pagar s?o tabela separada de lan?amentos

Uma conta ? um **compromisso futuro**; um lan?amento ? um **fato passado**.
Misturar os dois faria o gasto do m?s contar dinheiro que ainda n?o saiu. O
v?nculo `transactions.billId` ? o que responde "o aluguel de mar?o foi pago?" ?
a exist?ncia do lan?amento no m?s **?** o pagamento, sem tabela de status.

---

## Restri??es do ambiente (importante)

Esta m?quina tem o **Smart App Control do Windows em modo enforce**. Ele bloqueia
a execu??o de bin?rios n?o assinados, e isso derrubou v?rias escolhas ?bvias de
stack. As substitui??es abaixo n?o s?o prefer?ncia ? s?o o que roda aqui.

| Bloqueado | Substituto | Por qu? |
|---|---|---|
| **Prisma** | `node:sqlite` | O schema engine ? um `.exe` n?o assinado. `node:sqlite` vive dentro do `node.exe`, que ? assinado |
| **Tailwind v4** | **Tailwind v3** | A v4 depende de dois bin?rios nativos (`@tailwindcss/oxide` e `lightningcss`). A v3 ? PostCSS puro em JS |
| **Turbopack** | **webpack** (`--webpack`) | Turbopack exige bindings nativos e n?o tem fallback. O Next cai para SWC em WASM sozinho |
| **Instalador do python.org** | Python da Microsoft Store | O instalador falha com `0x800711C7 "Failed to run per-user mode"` |

Consequ?ncias pr?ticas:

- Os scripts `dev` e `build` **j? v?m com `--webpack`**. Rodar `next dev` sem a
  flag falha com "Turbopack is not supported on this platform".
- O aviso `Attempted to load @next/swc-win32-x64-msvc... bloqueado` aparece
toda vez. ? esperado ? o Next segue com o SWC em WASM. Build fica mais lento;
o resultado ? id?ntico.
- Se voc? desligar o Smart App Control um dia, d? para voltar para Turbopack e
  Tailwind v4. **Aten??o: no Windows, desligar ? irrevers?vel** ? n?o d? para
  reativar sem reinstalar o sistema.

### Verificando se o ambiente mudou

```powershell
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy").VerifiedAndReputablePolicyState
# 0 = desligado | 1 = enforce | 2 = avalia??o
```

---

## Design

O visual segue `design-system/girofin/MASTER.md`, gerado pela skill
**ui-ux-pro-max** e revisado. Esse arquivo documenta o que foi mantido da
sa?da da skill e o que foi sobrescrito, sempre com o motivo.

Tr?s corre??es relevantes:

1. **Tipografia** ? a skill sugeriu *Caveat* (manuscrita, para blogs pessoais).
   Trocado por **IBM Plex Sans/Mono**, o par "Financial Trust" da pr?pria base
dela. Todo valor monet?rio ? mono com `tabular-nums` para as colunas alinharem.
2. **Contraste** ? o `.btn-primary` gerado usava texto branco sobre `#059669`
   (3,77:1, reprova no crit?rio 4.5:1 da pr?pria checklist da skill). Corrigido
   para preto (5,57:1). Verde e vermelho de **texto** usam vers?es clareadas
   (`#34d399`, `#f87171`), porque os tons de preenchimento reprovam como texto
   sobre o card.
3. **Paleta dos gr?ficos** ? as cores que eu tinha escolhido a olho reprovaram
   no validador da skill de dataviz: 4 fora da faixa de luminosidade e dois azuis
   com ?E 9,8 para vis?o normal (piso 15). Substitu?das pela paleta de refer?ncia
   validada, revalidada contra a superf?cie de card deste app (`#192134`):
   todos os 6 checks passam.

Regras seguidas em todo gr?fico: identidade em dois canais (cor + r?tulo direto
ou tra?o distinto), tabela alternativa em cada gr?fico, eixo ?nico, e nada de
pizza.

---

## Backup

O banco inteiro ? um arquivo. Copie `data/financeiro.db` para onde quiser.

Para abrir um backup sem sobrescrever o atual:

```powershell
$env:FINANCEIRO_DB="C:\caminho\doackup.db"; npm run dev
```

`data/` est? no `.gitignore`. ? o seu extrato ? n?o versione.

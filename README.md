# Controle Financeiro

Lançamento diário de gastos com categorização automática, contas a pagar e
boletos, projeção de investimentos com taxas reais do Banco Central, e um motor
de recomendação que aponta onde dá para economizar.

Tudo roda local. O banco é um arquivo em `data/financeiro.db` e nada sai desta
máquina — nenhum extrato, nenhum valor, nenhum boleto.

---

## Começando

```bash
npm install
npm run dev          # http://localhost:3000
```

O banco é criado sozinho na primeira execução, já com 13 categorias e o
vocabulário de categorização. Não há passo de migração para rodar.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm start` | Roda o build |
| `npm test` | 44 testes das regras de negócio (dinheiro, datas, juros, categorização) |
| `npm run typecheck` | Checagem de tipos |

---

## O dia a dia: lançamento rápido

Na tela **Lançar**, escreva o dia inteiro em texto corrido:

```
padaria sao joao 18,50
99 pop 23
carrefour compras do mes 342,80
netflix 39,90
+salario 5400
```

`Ctrl + Enter` interpreta. O app separa descrição e valor, identifica a
categoria e mostra o que entendeu **antes** de salvar.

Regras do formato:

- **Um lançamento por linha** (ou separados por `;`)
- **O valor é o último número da linha** — por isso `99 pop 23` funciona:
  descrição "99 pop", valor R$ 23,00
- **`+` no começo marca entrada.** Sem ele, é saída
- Aceita `1.234,56`, `1234,56`, `1234.56`, `R$ 89,90` e `89`

### Como a categorização funciona

100% local e determinístico — sem chamada a nenhuma API de IA. Três razões:
lançar gasto é operação de todo dia e não pode depender de rede; extrato é dado
sensível e não precisa sair da máquina; e o mesmo texto tem que cair sempre na
mesma categoria, senão o histórico fica incomparável.

O acerto vem de duas fontes:

1. **Vocabulário embutido** — ~150 termos e marcas reais (`ifood`, `uber`,
   `carrefour`, `netflix`, `drogaria`...), porque é assim que a despesa aparece
   no extrato e na memória de quem digita.
2. **O que você ensina** — quando você corrige um palpite, o app grava a regra.
   Corrigir uma vez ensina para sempre, e regra aprendida tem peso maior que a
   embutida.

Palpite com confiança baixa vem destacado em âmbar e a linha diz **por qual
palavra** ele reconheceu — para você poder discordar com base em algo.

---

## As telas

| Tela | Responde |
|---|---|
| **Resumo** | Como estou este mês? Entradas, saídas, e o "livre de verdade" |
| **Lançar** | Registrar o dia + lista do mês com busca e filtro |
| **Contas** | O que tenho para pagar? Contas fixas e boletos, com vencimento e quitação |
| **Investir** | Quanto meu dinheiro vira? Projeção com CDI/Selic/poupança reais |
| **Economizar** | Onde estou perdendo dinheiro? Diagnóstico com valores e ações |

### "Livre de verdade"

O número mais útil do resumo. Não é o saldo — é o saldo **menos as contas ainda
em aberto**. A diferença entre achar que pode gastar e poder de fato.

### Contas fixas e boletos

Mesma tela para os dois, porque a pergunta é a mesma ("o que eu tenho pra
pagar?"):

- **Conta fixa** — volta todo mês num dia do vencimento (aluguel, luz, internet)
- **Boleto avulso** — data única (IPVA, matrícula, parcela)

Marque uma conta como **variável** (luz, água, cartão) e o valor cadastrado
passa a ser tratado como estimativa. Na hora de quitar, o campo vem preenchido
com o previsto para você corrigir — o que entra no histórico é o valor que
realmente saiu, nunca o estimado.

Guarda a linha digitável opcionalmente, só para copiar na hora de pagar.

### Taxas do Banco Central

Vêm da API pública SGS: Selic (série 432), CDI (4389) e IPCA (433, acumulado
de 12 meses por composição, não por soma).

Resiliência em três camadas: cache local de 12h → API → constante de emergência.
**A tela sempre diz qual camada está sendo usada.** Taxa desatualizada
apresentada como atual, numa ferramenta de decisão financeira, é pior que
nenhuma taxa.

### Motor de recomendação

Cada conselho carrega um **número** e uma **ação**. "Cuidado com gastos" não muda
comportamento; "corte R$ 189,30 em Restaurantes — isso vira R$ 15.918 em 5 anos"
muda.

O que ele detecta: contas vencidas, mês no vermelho, desvios da regra 50/30/20,
estouro de orçamento por categoria, saltos de gasto mês a mês, peso dos gastos
recorrentes, e reserva de emergência abaixo de 6 meses de custo.

---

## Decisões técnicas

### Dinheiro é inteiro, em centavos

Nunca `float`. `0.1 + 0.2` dá `0.30000000000000004` em qualquer linguagem com
IEEE-754; somando centenas de lançamentos por ano, esse erro vira diferença
visível no fechamento do mês. Conversão para texto só na borda de renderização
(`src/lib/money.ts`).

### Datas são string `"YYYY-MM-DD"`, nunca `Date`

`new Date("2026-03-01")` é lido como UTC meia-noite. Em UTC-3 isso vira 28/02
às 21h local — o lançamento do dia 1º cai no mês anterior e o fechamento sai
errado. String pura não tem fuso (`src/lib/dates.ts`).

### O sinal mora no `type`, não no valor

Todo `amountCents` é positivo, com `CHECK (amountCents > 0)` no banco. Guardar
despesa como negativo duplicaria a fonte de verdade e faria toda soma depender
de saber qual convenção foi usada.

### Contas a pagar são tabela separada de lançamentos

Uma conta é um **compromisso futuro**; um lançamento é um **fato passado**.
Misturar os dois faria o gasto do mês contar dinheiro que ainda não saiu. O
vínculo `transactions.billId` é o que responde "o aluguel de março foi pago?" —
a existência do lançamento no mês **é** o pagamento, sem tabela de status.

---

## Restrições do ambiente (importante)

Esta máquina tem o **Smart App Control do Windows em modo enforce**. Ele bloqueia
a execução de binários não assinados, e isso derrubou várias escolhas óbvias de
stack. As substituições abaixo não são preferência — são o que roda aqui.

| Bloqueado | Substituto | Por quê |
|---|---|---|
| **Prisma** | `node:sqlite` | O schema engine é um `.exe` não assinado. `node:sqlite` vive dentro do `node.exe`, que é assinado |
| **Tailwind v4** | **Tailwind v3** | A v4 depende de dois binários nativos (`@tailwindcss/oxide` e `lightningcss`). A v3 é PostCSS puro em JS |
| **Turbopack** | **webpack** (`--webpack`) | Turbopack exige bindings nativos e não tem fallback. O Next cai para SWC em WASM sozinho |
| **Instalador do python.org** | Python da Microsoft Store | O instalador falha com `0x800711C7 "Failed to run per-user mode"` |

Consequências práticas:

- Os scripts `dev` e `build` **já vêm com `--webpack`**. Rodar `next dev` sem a
  flag falha com "Turbopack is not supported on this platform".
- O aviso `Attempted to load @next/swc-win32-x64-msvc... bloqueado` aparece
  toda vez. É esperado — o Next segue com o SWC em WASM. Build fica mais lento;
  o resultado é idêntico.
- Se você desligar o Smart App Control um dia, dá para voltar para Turbopack e
  Tailwind v4. **Atenção: no Windows, desligar é irreversível** — não dá para
  reativar sem reinstalar o sistema.

### Verificando se o ambiente mudou

```powershell
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy").VerifiedAndReputablePolicyState
# 0 = desligado | 1 = enforce | 2 = avaliação
```

---

## Design

O visual segue `design-system/controle-financeiro/MASTER.md`, gerado pela skill
**ui-ux-pro-max** e revisado. Esse arquivo documenta o que foi mantido da
saída da skill e o que foi sobrescrito, sempre com o motivo.

Três correções relevantes:

1. **Tipografia** — a skill sugeriu *Caveat* (manuscrita, para blogs pessoais).
   Trocado por **IBM Plex Sans/Mono**, o par "Financial Trust" da própria base
   dela. Todo valor monetário é mono com `tabular-nums` para as colunas alinharem.
2. **Contraste** — o `.btn-primary` gerado usava texto branco sobre `#059669`
   (3,77:1, reprova no critério 4.5:1 da própria checklist da skill). Corrigido
   para preto (5,57:1). Verde e vermelho de **texto** usam versões clareadas
   (`#34d399`, `#f87171`), porque os tons de preenchimento reprovam como texto
   sobre o card.
3. **Paleta dos gráficos** — as cores que eu tinha escolhido a olho reprovaram
   no validador da skill de dataviz: 4 fora da faixa de luminosidade e dois azuis
   com ΔE 9,8 para visão normal (piso 15). Substituídas pela paleta de referência
   validada, revalidada contra a superfície de card deste app (`#192134`):
   todos os 6 checks passam.

Regras seguidas em todo gráfico: identidade em dois canais (cor + rótulo direto
ou traço distinto), tabela alternativa em cada gráfico, eixo único, e nada de
pizza.

---

## Backup

O banco inteiro é um arquivo. Copie `data/financeiro.db` para onde quiser.

Para abrir um backup sem sobrescrever o atual:

```powershell
$env:FINANCEIRO_DB="C:\caminho\do\backup.db"; npm run dev
```

`data/` está no `.gitignore`. É o seu extrato — não versione.

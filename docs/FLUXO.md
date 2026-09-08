# Fluxo de branches e deploy

Como o código sai da sua máquina e chega em produção.

## As branches

| Branch | Papel | Deploy |
|---|---|---|
| `feat/*`, `fix/*` | Onde o trabalho acontece | nenhum |
| `develop` | Integração — tudo entra por aqui | nenhum |
| `staging` | Pré-produção, para validar de verdade | automático → `girofin-staging-1704` |
| `Master` | Produção | automático → `girofin-prod-1704` |

```
fix/xxx  ou  feat/xxx
     │  PR
     ▼
  develop      integração, não publica
     │  fast-forward
     ▼
  staging      publica em staging
     │  fast-forward
     ▼
  Master       publica em produção
```

## A regra que sustenta tudo

**Código só entra por `develop`.** Nunca commite direto em `staging` ou
`Master`.

Isso não é preferência estética. `staging` e `Master` avançam por
fast-forward a partir de `develop`: se alguém commitar direto numa delas, o
fast-forward passa a falhar e as três branches divergem — foi exatamente o que
aconteceu em 07/09/2026, quando commits foram para `staging` e `Master` sem
passar por `develop` e a branch de integração ficou cinco commits atrás das
outras duas.

O `--ff-only` nos comandos abaixo é proposital: quando ele falha, é sinal de
divergência para você reconciliar, em vez de um merge commit silencioso que
faz staging e produção deixarem de ser a mesma coisa.

## Achei um erro no staging. E agora?

Erro e funcionalidade nova seguem o **mesmo caminho**. Muda o prefixo do nome
da branch e a pressa, nada mais.

```bash
# 1. sai de develop atualizado
git checkout develop && git pull

# 2. branch com nome que diz o que é
git checkout -b fix/codigo-confirmacao-expira-cedo

# 3. corrige e valida ANTES de commitar
npm run typecheck && npm run lint && npm test

# 4. commita e sobe a branch
git push -u origin fix/codigo-confirmacao-expira-cedo

# 5. abre PR para develop — o CI roda sozinho
#    merge quando estiver verde (nada é publicado ainda)

# 6. leva para staging e testa lá
git checkout staging && git merge --ff-only develop && git push origin staging

# 7. só depois de validado em staging
git checkout Master && git merge --ff-only develop && git push origin Master
```

## Hotfix: produção queimando agora

Única exceção ao caminho acima.

```bash
git checkout Master && git pull
git checkout -b hotfix/descricao-curta
# corrige, valida, commita
git push -u origin hotfix/descricao-curta
# PR para Master, merge → publica

# E O PASSO QUE NÃO PODE SER ESQUECIDO:
git checkout develop && git merge Master && git push origin develop
git checkout staging && git merge --ff-only develop && git push origin staging
```

Sem esse retorno, a correção some no próximo deploy normal — `develop` não a
tem, e o próximo fast-forward para `Master` a sobrescreve.

## O que roda sozinho

**`.github/workflows/ci.yml`** — em todo PR e em todo push para `develop`,
`staging` e `Master`: `typecheck`, `lint`, `test` e `build`. É o portão que
impede um commit quebrado de chegar em staging.

**`.github/workflows/deploy-staging.yml`** — push em `staging` publica em
`girofin-staging-1704`.

**`.github/workflows/deploy-production.yml`** — push em `Master` publica em
`girofin-prod-1704`.

Os dois de deploy usam `vars.AZURE_WEBAPP_NAME` e
`secrets.AZURE_WEBAPP_PUBLISH_PROFILE`, configurados por environment no GitHub.

## Configuração pendente no GitHub

Isto é na interface, em Settings → Branches → Add rule. Não dá para fazer por
código:

- **`Master`**: exigir pull request, exigir que o CI passe, bloquear push
  direto.
- **`staging`**: exigir que o CI passe.

Sem isso, o fluxo depende de disciplina. Com isso, ele é garantido pela
plataforma.

## Nomes de branch

| Prefixo | Quando |
|---|---|
| `feat/` | funcionalidade nova |
| `fix/` | correção de algo quebrado |
| `hotfix/` | correção urgente saindo de `Master` |
| `chore/` | build, dependência, configuração |
| `docs/` | só documentação |

Depois do nome, uma descrição curta em minúsculas separada por hífen, dizendo
o que muda — não o número do ticket. `fix/codigo-confirmacao-expira-cedo` diz
o que é; `fix/bug-123` obriga a abrir outra aba.

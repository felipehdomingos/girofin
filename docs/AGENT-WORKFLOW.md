# Fluxo de trabalho por especialidade

O desenvolvimento do GiroFin segue uma cadeia de responsabilidade clara:

```text
UX/UI -> Dev Backend/Frontend -> QA -> Documentação -> staging
```

## UX/UI

Define a experiência antes da implementação:

- fluxo de navegação e estados da interface;
- hierarquia visual, responsividade e acessibilidade;
- comportamento dos temas claro e escuro;
- componentes, textos e estados vazios, de erro e carregamento.

Entrega decisões de design implementáveis, sem deixar regras visuais implícitas.

## Dev

Implementa o que foi definido pelo UX/UI na branch `develop`:

- conecta interface, regras de negócio e persistência;
- preserva os padrões existentes do projeto;
- adiciona ou atualiza testes quando o comportamento muda;
- executa typecheck, build e testes aplicáveis;
- não publica diretamente em `Master`.

## Dev Backend

Trabalha em conjunto com Dev na camada de servidor e na API pública:

- define contratos versionados e exemplos para clientes web e mobile;
- retorna mensagens claras e acionaveis para o front, com codigos de erro estaveis;
- protege cada rota com autenticação e autorização explícitas;
- implementa sessões, access tokens e refresh tokens com rotação e revogação;
- mantém OpenAPI e collection Postman sincronizadas;
- garante isolamento por usuário no PostgreSQL;
- testa expiração, replay, rate limiting, erros e falhas de dependências;
- não publica diretamente em `Master`.

## QA

Valida a implementação antes da promoção:

- fluxos principais e casos de erro;
- autenticação, autorização e persistência;
- responsividade e temas;
- regressões nas áreas não alteradas;
- smoke test do ambiente `staging`.

Toda falha deve registrar reprodução, resultado esperado, resultado atual e evidência.

## Documentação

Registra o resultado do trabalho:

- decisões de UX/UI e suas justificativas;
- alterações técnicas e variáveis de ambiente;
- comandos de validação e resultados;
- limitações conhecidas e próximos passos;
- instruções de deploy e rollback quando aplicável.

## Ambientes e promoção

- `develop`: implementação das mudanças.
- `staging`: testes integrados e validação do comportamento publicado.
- `Master`: produção; recebe mudanças por Pull Request da `develop`.

`staging` não é mesclada em `Master`. O código validado deve ser promovido por
PR de `develop` para `Master`.

## Critério de conclusão

Uma mudança só é considerada pronta quando:

1. UX/UI definiu o comportamento, quando houver impacto visual ou de fluxo.
2. Dev implementou e validou a alteração.
3. QA testou os cenários relevantes em `staging`.
4. Documentação registrou o resultado.

# GiroFin - Design unico do produto

Este e o documento canonico de design do GiroFin. O Stitch deve usar somente
este arquivo. Ele unifica autenticacao, area financeira, identidade visual,
temas, componentes, estados e regras de interacao em um unico produto.

## 1. Essencia do produto

O GiroFin e um controle financeiro pessoal brasileiro para responder rapidamente:

> Como estou financeiramente e qual e a proxima decisao certa?

Personalidade:

- confiavel;
- claro;
- pratico;
- moderno;
- prudente;
- humano;
- privado por padrao.

Slogan:

> Organize hoje. Viva melhor.

Evitar visual de banco corporativo, planilha sem hierarquia, excesso de gradientes,
alertas moralizantes, emojis como icones e numeros sem contexto.

## 2. Regra de unificacao

Autenticacao e area financeira sao contextos do mesmo produto. Nao criar dois
designs diferentes.

- Uma marca: GiroFin.
- Um sistema de tokens para claro e escuro.
- Uma tipografia e uma escala de espacamento.
- Os mesmos botoes, campos, cards, alertas e estados.
- O shell de login e dedicado, mas compartilha logo, slogan e componentes.
- O shell autenticado adiciona navegacao e dados, sem mudar a linguagem visual.

## 3. Identidade visual

### 3.1 Logo

Criar:

- lockup horizontal GiroFin;
- simbolo isolado para avatar e favicon;
- versao para fundo claro;
- versao para fundo escuro;
- uso sem sombra pesada, deformacao ou contorno artificial.

Aplicacao:

- sidebar desktop: largura aproximada de 144 px;
- cabecalho mobile: 112 a 128 px;
- autenticacao: acima do card, centralizado no mobile;
- area financeira: no topo da sidebar.

### 3.2 Tipografia

- IBM Plex Sans para interface;
- IBM Plex Mono para dinheiro, tabelas e identificadores;
- titulos com peso 600 ou 700;
- corpo com peso 400 ou 500;
- numeros financeiros com `tabular-nums`.

### 3.3 Tokens

Tema escuro:

| Token | Valor | Uso |
|---|---|---|
| background | `#0F172A` | fundo geral |
| card | `#192134` | cards e superficies |
| foreground | `#FFFFFF` | texto principal |
| muted-foreground | `#94A3B8` | texto auxiliar |
| primary | `#1E40AF` | selecao e destaque |
| accent | `#059669` | acao positiva |
| positive-text | `#34D399` | entrada e sucesso |
| negative-text | `#F87171` | saida e erro |
| border | branco com 8% de opacidade | divisorias |

Tema claro:

| Token | Valor | Uso |
|---|---|---|
| background | `#F8FAFC` | fundo geral |
| card | `#FFFFFF` | cards e superficies |
| foreground | `#0F172A` | texto principal |
| muted-foreground | `#475569` | texto auxiliar |
| primary | `#1D4ED8` | selecao e destaque |
| accent | `#047857` | acao positiva |
| positive-text | `#047857` | entrada e sucesso |
| negative-text | `#B91C1C` | saida e erro |
| border | navy com 12% de opacidade | divisorias |

### 3.4 Superficies

- raio de card: 12 px;
- raio de controle: 8 px;
- modal: 16 px;
- bordas discretas;
- sombra baixa;
- glassmorphism sutil, nunca decorativo;
- contraste deve continuar legivel sem depender de blur.

## 4. Shells

### 4.1 Shell de autenticacao

Usar uma pagina dedicada, sem sidebar financeira:

- fundo do tema;
- logo;
- slogan;
- card de 400 a 480 px no desktop;
- largura total com padding de 16 a 24 px no mobile;
- um unico landmark `main`;
- alternancia de tema acessivel;
- nenhum dado financeiro antes da sessao.

### 4.2 Shell autenticado

Desktop:

- sidebar fixa de aproximadamente 240 px;
- logo no topo;
- slogan abaixo da marca;
- navegacao vertical;
- botao `Sair` no rodape;
- conteudo com largura flexivel.

Mobile:

- cabecalho compacto;
- navegacao inferior fixa;
- alvos de toque de no minimo 44 px;
- padding inferior para nao esconder conteudo;
- menu de configuracoes acessivel.

## 5. Navegacao

Itens principais:

- Resumo;
- Relatorios;
- A pagar;
- Investir;
- Economia;
- Configuracoes;
- Cartoes, somente quando houver cartao cadastrado.

Regras:

- item ativo com destaque claro;
- icone e texto, nunca somente icone no desktop;
- foco de teclado sempre visivel;
- navegacao inferior no mobile;
- `Sair` sempre visivel no shell autenticado.

## 6. Autenticacao

### 6.1 Login

Hierarquia:

1. logo;
2. slogan;
3. titulo `Entrar`;
4. descricao `Acesse seu controle financeiro.`;
5. email;
6. senha;
7. `Esqueci minha senha`;
8. botao `Entrar`;
9. `Criar cadastro`.

Campos:

- labels visiveis;
- `email` com autocomplete de email;
- senha com autocomplete de senha atual;
- mostrar/ocultar senha;
- campos com no minimo 44 px;
- nao bloquear gerenciadores de senha.

Estados:

- inicial;
- foco;
- preenchido;
- enviando;
- credencial invalida;
- servico indisponivel;
- sucesso;
- sessao expirada.

Mensagens:

- erro: `E-mail ou senha invalidos.`;
- indisponibilidade: `O servico de autenticacao esta temporariamente indisponivel.`;
- loading: `Entrando...`;
- erro com `role="alert"`;
- sucesso com `role="status"`.

Sucesso redireciona para o Resumo usando substituicao de historico.

### 6.2 Cadastro

Campos:

- nome;
- email;
- senha;
- confirmacao de senha.

Regras:

- nome entre 2 e 80 caracteres;
- senha entre 10 e 200 caracteres;
- confirmar senha no cliente;
- normalizar email no servidor;
- criar sessao depois do cadastro;
- redirecionar para o Resumo.

### 6.3 Recuperacao

Tela `/recuperar-senha`:

- titulo `Recuperar senha`;
- campo email;
- botao `Enviar instrucoes`;
- resposta sempre generica para nao revelar se a conta existe.

Mensagem:

> Se o email estiver cadastrado, voce recebera instrucoes para redefinir a senha.

### 6.4 Redefinicao

Tela `/redefinir-senha?token=...`:

- nova senha;
- confirmacao;
- requisitos visiveis;
- token nunca exibido;
- token de uso unico;
- expiracao de 60 minutos;
- invalidar sessoes antigas apos troca.

Sem token:

- nao mostrar formulario;
- mostrar `Link invalido`;
- CTA `Solicitar novo link`;
- link `Voltar para entrar`.

Sucesso:

- mensagem `Senha redefinida.`;
- CTA direto para `Entrar`.

### 6.5 Logout

No menu autenticado:

- icone de saida;
- label `Sair`;
- loading `Saindo...`;
- invalidar sessao no servidor;
- apagar cookie;
- redirecionar para login.

## 7. Dashboard e telas financeiras

### 7.1 Resumo

Objetivo: leitura em cinco segundos.

Ordem:

1. saudacao e periodo;
2. saldo livre de verdade;
3. entradas;
4. saidas;
5. resultado do mes;
6. contas a vencer;
7. distribuicao por categoria;
8. proxima acao recomendada.

Cada numero precisa de:

- periodo;
- origem;
- sinal quando necessario;
- explicacao ao tocar ou focar.

### 7.2 Lancamentos

O cadastro deve ser rapido, mas seguro:

- botao `Novo lancamento`;
- tipo entrada ou saida;
- valor;
- data;
- descricao;
- categoria;
- conta ou cartao;
- natureza: vista, fixo ou parcelado;
- revisao antes de salvar quando houver interpretacao automatica.

Nunca salvar uma classificacao automatica sem permitir revisao.

### 7.3 Relatorios

- filtros por periodo;
- graficos com legenda;
- alternativa em tabela;
- categorias ordenadas por impacto;
- estados vazio, carregando e erro;
- textos que explicam o que fazer com a informacao.

### 7.4 Contas a pagar

- vencidas em destaque sem alarmismo;
- proximas contas ordenadas por data;
- origem de pagamento obrigatoria quando quitar;
- quitar nao pode duplicar despesa;
- estado vazio orienta como cadastrar compromisso.

### 7.5 Investimentos

- objetivo;
- valor atual;
- contribuicao mensal;
- prazo;
- taxa;
- simulacao;
- aviso de premissas;
- nunca apresentar projecao como garantia.

### 7.6 Economia

- comparacao de meses;
- oportunidades praticas;
- categorias que mais impactam;
- recomendacao acionavel;
- evitar tom moralizante.

### 7.7 Configuracoes

Abas:

- Geral;
- Contas;
- Cartoes;
- Empresas;
- Categorias.

Em Geral:

- tema claro/escuro;
- preferencia persistida;
- explicacao curta da escolha.

## 8. Componentes

Criar componentes consistentes para:

- BrandLogo;
- ThemeToggle;
- Button;
- TextField;
- PasswordField;
- Select;
- Alert;
- Toast;
- Card;
- EmptyState;
- LoadingState;
- ErrorState;
- Modal;
- ConfirmDialog;
- MoneyValue;
- PeriodSelector;
- Navigation;
- LogoutButton.

Cada componente precisa definir:

- estado normal;
- hover;
- foco;
- pressionado;
- desabilitado;
- carregando;
- erro;
- claro;
- escuro;
- mobile;
- desktop.

## 9. Estados obrigatorios

Toda tela deve ter design para:

- carregamento;
- vazio;
- sucesso;
- erro recuperavel;
- erro de validacao;
- indisponibilidade;
- sessao expirada;
- permissao negada;
- confirmacao destrutiva.

Erros devem explicar:

1. o que aconteceu;
2. o impacto;
3. como corrigir.

## 10. Acessibilidade

- labels visiveis;
- foco visivel;
- teclado em todos os fluxos;
- `role="alert"` em erros;
- `role="status"` em sucesso;
- `aria-busy` durante envio;
- `aria-invalid` e `aria-describedby` em campos invalidos;
- contraste WCAG AA;
- targets de toque de 44 px;
- zoom de 200% sem perda;
- respeitar `prefers-reduced-motion`;
- graficos com tabela equivalente;
- nao depender somente de cor.

## 11. Seguranca representada no design

O design deve comunicar privacidade sem prometer o que o sistema nao garante:

- nao mostrar senha;
- nao exibir token de recuperacao;
- usar mensagens genericas para email;
- sessao expirada deve pedir login novamente;
- dados financeiros somente depois da autenticacao;
- nao exibir dados de outro usuario;
- nao colocar credenciais de teste na interface.

## 12. Criterios de aceite

O design unico esta correto quando:

1. login e dashboard parecem partes do mesmo produto;
2. tema claro e escuro sao variacoes do mesmo sistema;
3. a marca e o slogan aparecem de forma consistente;
4. mobile e desktop tem hierarquia equivalente;
5. todos os fluxos de autenticacao possuem estados completos;
6. cada tela financeira possui vazio, loading, erro e sucesso;
7. todos os componentes tem foco, teclado e contraste;
8. numeros financeiros sempre tem contexto;
9. logout e sessao expirada sao claros;
10. o design pode ser implementado por componentes React reutilizaveis.

## 13. Prompt unico para o Stitch

Crie um design completo e unificado para o GiroFin, um app brasileiro de
controle financeiro pessoal. Use uma unica linguagem visual para autenticacao e
area financeira. A marca e GiroFin, com o slogan "Organize hoje. Viva melhor.".
Crie logo para fundo claro e escuro, tema claro e escuro, IBM Plex Sans para
interface e IBM Plex Mono para valores.

Gere as telas de login, cadastro, recuperacao de senha, redefinicao de senha,
Resumo, Relatorios, A pagar, Investir, Economia e Configuracoes. O login deve
usar shell dedicado sem sidebar, mas compartilhar exatamente os mesmos tokens,
logo, tipografia, botoes, campos, cards, alertas e estados do restante do app.

Use fundo navy no escuro e quase branco no claro, cards discretos, bordas suaves,
contraste alto, densidade de dashboard e responsividade real. Desktop usa
sidebar de 240 px; mobile usa navegacao inferior fixa com alvos de 44 px.

Modele todos os estados: normal, hover, foco, preenchido, carregando, sucesso,
erro, vazio, indisponibilidade, sessao expirada, link de senha invalido, senha
fraca, email duplicado e confirmacao diferente. Use portugues do Brasil com
textos humanos e acionaveis.

O resultado deve ser um sistema de design implementavel, nao apenas mockups:
mostre componentes, tokens, medidas, comportamento responsivo, acessibilidade,
hierarquia, interacoes, navegacao e regras de transicao entre telas. Nao crie
um design separado para login. Crie um unico produto GiroFin coerente.

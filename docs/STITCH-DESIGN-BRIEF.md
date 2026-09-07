# GiroFin - UX/UI Design Brief para Stitch

## 1. Objetivo e escopo

Este documento traduz a implementacao atual do GiroFin em uma especificacao visual e
interativa pronta para colar no Stitch. O produto e um controle financeiro pessoal
em portugues do Brasil, com foco em confianca, leitura rapida de numeros, privacidade
e decisao pratica.

A analise foi feita diretamente no codigo de `src/app`, `src/components`,
`src/app/globals.css`, `tailwind.config.ts`, `design-system/girofin/MASTER.md` e nos
ativos de marca em `public/brand`.

## 0. Como usar este documento

Cole a secao **Prompt consolidado para o Stitch** no Stitch para gerar a
primeira proposta visual. Use as secoes anteriores como criterio de revisao:
o resultado deve preservar os fluxos, a hierarquia e os estados descritos aqui,
mesmo quando a composicao visual for reinterpretada.

Principios do produto:

- Responder "como estou financeiramente?" em aproximadamente cinco segundos.
- Transformar registro de gastos em diagnostico e proxima acao.
- Nunca esconder a origem de um numero financeiro.
- Evitar que uma automacao de classificacao grave um erro silencioso.
- Usar linguagem humana e brasileira: entrada, saida, conta, fatura, vencimento,
  parcela, sobra e reserva.
- Privacidade por padrao: dados locais e leitura de PDF no navegador.

## 2. Diagnostico do produto existente

O GiroFin ja tem uma direcao de produto consistente:

- App shell com sidebar no desktop e navegacao inferior no mobile.
- Tema escuro como padrao, com alternancia para tema claro.
- Superficies de vidro discretas, bordas suaves e alta densidade de informacao.
- IBM Plex Sans para interface e IBM Plex Mono para dinheiro e dados tabulares.
- Dados monetarios sempre com sinal explicito quando representam entrada ou saida.
- Formularios com labels visiveis, ajuda contextual, validacao por campo e feedback
  de sucesso/erro.
- Fluxos de alto risco em duas etapas: interpretar e revisar antes de salvar,
  ou escolher origem antes de quitar.
- Graficos com alternativa em tabela.
- Navegacao por URL para periodo e mes, preservando voltar, compartilhar e favoritos.

Rotas legadas observadas:

- `/lancamentos` redireciona para `/relatorios`; o cadastro foi movido para o popup
  "Novo lancamento".
- `/carteiras` e `/categorias` redirecionam para `/configuracoes`; os cadastros
  foram consolidados em abas.

## 3. Identidade visual

### 3.1 Personalidade

Posicionamento visual: fintech pessoal confiavel, moderna, seria e pratica.

Palavras-chave:

- confianca;
- controle;
- clareza;
- progresso;
- prudencia;
- autonomia;
- dados concretos.

Evitar:

- estetica de banco corporativo excessivamente fria;
- visual de planilha sem hierarquia;
- excesso de gradientes ou efeitos decorativos;
- emojis como icones;
- textos alarmistas ou moralizantes;
- cards com numeros sem contexto.

### 3.2 Logo claro e escuro

Ativos existentes:

- `public/brand/girofin-dark.png`: usado no tema claro, para aparecer sobre fundo
  claro.
- `public/brand/girofin-light.png`: usado no tema escuro, para aparecer sobre fundo
  escuro.

O componente `BrandLogo` alterna os dois PNGs por `data-theme`, com largura maxima
de 144 px e cantos de 8 px. No Stitch:

- criar lockup horizontal GiroFin + simbolo, preservando proporcao;
- oferecer versao horizontal e simbolo isolado para avatar, favicon e mobile;
- versao clara: wordmark escuro/azul sobre fundo claro;
- versao escura: wordmark claro/branco sobre fundo navy;
- nao aplicar sombra pesada, contorno, gradiente ou deformacao;
- reservar area de protecao equivalente a pelo menos 25% da altura do logo;
- manter contraste suficiente contra `#F8FAFC` e `#0F172A`.

Uso recomendado:

- desktop: logo no topo da sidebar, com aproximadamente 144 px de largura;
- mobile: logo no topo da tela ou em cabecalho compacto, com 112-128 px;
- autenticacao: logo acima do cartao do formulario, sem competir com o titulo.

### 3.3 Tom de voz

Usar frases curtas, concretas e orientadas a acao:

- "Novo lancamento"
- "Livre de verdade"
- "Contas a pagar"
- "Ver contas"
- "Confira antes de salvar"
- "O que fazer"
- "Meta atingida"

Mensagens de risco explicam a consequencia, nao apenas o erro. Exemplo:
"O dinheiro precisa sair de uma conta para o saldo fechar."

## 4. Tokens de design

### 4.1 Cores - tema escuro (padrao)

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#1E40AF` | destaque institucional, selecao e links de alta prioridade |
| `on-primary` | `#FFFFFF` | texto sobre primary |
| `secondary` | `#3B82F6` | informacao, links secundarios e barras neutras |
| `on-secondary` | `#000000` | texto sobre secondary quando aplicavel |
| `accent` | `#059669` | CTA principal, sucesso e valores positivos |
| `on-accent` | `#000000` | texto em botoes verdes |
| `background` | `#0F172A` | fundo global |
| `foreground` | `#FFFFFF` | texto principal |
| `card` | `#192134` | cards, modais e superficies elevadas |
| `card-foreground` | `#FFFFFF` | texto em card |
| `muted` | `#101A34` | campos, superficies secundarias e estados neutros |
| `muted-foreground` | `#94A3B8` | texto auxiliar |
| `border` | `rgba(255,255,255,0.08)` | divisorias e contornos |
| `destructive` | `#DC2626` | erro, atraso, exclusao e saida negativa |
| `on-destructive` | `#FFFFFF` | texto sobre destructive |
| `ring` | `#FFFFFF` | foco de teclado |
| `pos-text` | `#34D399` | valores positivos em texto |
| `neg-text` | `#F87171` | valores negativos em texto |

Regra importante: `accent` e `destructive` sao tokens de preenchimento. Para texto
em fundo escuro usar `pos-text` e `neg-text`, evitando contraste insuficiente.
Entrada e saida nunca podem depender apenas de cor: sempre mostrar sinal (`+` ou
`-`), rotulo ou icone.

### 4.2 Cores - tema claro

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#1D4ED8` | primaria clara |
| `secondary` | `#2563EB` | secundaria clara |
| `accent` | `#047857` | CTA/sucesso |
| `background` | `#F8FAFC` | fundo global |
| `foreground` | `#0F172A` | texto principal |
| `card` | `#FFFFFF` | superficie de card |
| `card-foreground` | `#0F172A` | texto em card |
| `muted` | `#EEF2FF` | campo e superficie secundaria |
| `muted-foreground` | `#475569` | texto auxiliar |
| `border` | `rgba(15,23,42,0.12)` | divisorias |
| `destructive` | `#B91C1C` | erro/negativo |
| `ring` | `#1D4ED8` | foco |
| `pos-text` | `#047857` | positivo |
| `neg-text` | `#B91C1C` | negativo |

Tema claro deve preservar a mesma hierarquia, nao ser uma interface diferente.
Cards brancos precisam manter borda ou sombra leve para nao desaparecerem sobre
`#F8FAFC`.

### 4.3 Tipografia

- Familia de interface: IBM Plex Sans.
- Familia numerica: IBM Plex Mono.
- Pesos: 400, 500, 600 e 700.
- Titulos de pagina: 24 px, peso 600, tracking ligeiramente fechado.
- Titulos de card: 14 px, peso 600.
- Corpo: 14-16 px.
- Labels: 12-13 px, peso 500.
- Auxiliar: 11-12 px, cor muted.
- Numeros financeiros: IBM Plex Mono, `font-variant-numeric: tabular-nums`.
- Campos de entrada: 16 px no mobile para evitar zoom automatico do iOS.

Os valores monetarios devem alinhar coluna a coluna. Em cards grandes usar 24 px;
em listas usar 12-14 px. Manter o prefixo `R$` e a convencao brasileira de
separador decimal.

### 4.4 Espacamento, raios e sombra

Escala densa existente:

- `xs`: 2 px
- `sm`: 4 px
- `md`: 8 px
- `lg`: 12 px
- `xl`: 16 px
- `2xl`: 24 px
- `3xl`: 32 px

Raios:

- controle: 8 px;
- card: 12 px;
- modal: 16 px;
- badge: pill.

Sombras:

- sm: `0 1px 2px rgba(0,0,0,0.05)`;
- md: `0 4px 6px rgba(0,0,0,0.10)`;
- lg: `0 10px 15px rgba(0,0,0,0.10)`;
- xl: `0 20px 25px rgba(0,0,0,0.15)`.

Glassmorphism:

- fundo de card com mistura translucida de `card`;
- blur de 14 px;
- borda de 1 px com `border`;
- nunca usar transparencia a ponto de prejudicar texto ou graficos.

### 4.5 Iconografia e movimento

- Usar Lucide ou outro conjunto SVG consistente.
- Icones sao decorativos quando o texto ao lado ja nomeia a acao.
- Alvo de toque minimo: 44 x 44 px; a barra mobile usa 56 px de altura.
- Transicoes: 150-300 ms, principalmente cor, borda e largura de progresso.
- Nao deslocar layout no hover.
- Graficos sem animacao de entrada; leitura financeira deve ser imediata.
- Respeitar `prefers-reduced-motion: reduce`.

## 5. App shell e layout responsivo

### 5.1 Desktop

Breakpoints propostos:

- 375 px: referencia minima mobile;
- 640 px: grid de duas colunas quando couber;
- 768 px: tablet;
- 1024 px (`lg`): shell desktop;
- 1280 px (`xl`): grids mais densos e quatro stat cards;
- 1440 px: area de conteudo confortavel, sem esticar cards indefinidamente.

No desktop:

- sidebar fixa/sticky de aproximadamente 240 px;
- logo e subtitulo "Controle Financeiro / Organize hoje. Viva melhor.";
- links em coluna com icone + texto;
- item ativo com fundo `primary` translucido, texto forte e `aria-current`;
- logout ancorado no rodape da sidebar;
- conteudo com `px-32`, `pt-16`, `pb-32`;
- grids de cards com gap de 16 px;
- formularios complexos em duas colunas: lista a esquerda e criacao/edicao a direita.

### 5.2 Mobile

- sidebar desaparece;
- navegacao fixa no rodape, com safe area para iPhone;
- 56 px de altura minima por item;
- reservar `padding-bottom` no conteudo para nao esconder o ultimo elemento;
- seis itens compactos podem ser exibidos porque cada alvo continua acima de 44 px:
  Resumo, Relatorios, A pagar, Investir, Economia e Config;
- Cartoes entra na navegacao somente quando existir cartao cadastrado;
- tabelas largas rolam dentro do proprio card, nunca a pagina inteira;
- grids viram uma coluna; cards mantem padding de 16-24 px;
- cabecalhos quebram em duas linhas quando o CTA nao couber;
- FAB de "Novo lancamento" fica acima da barra inferior, no canto inferior direito.

### 5.3 Navegacao

Mapa principal:

1. Resumo (`/`)
2. Relatorios (`/relatorios`)
3. A pagar (`/contas`)
4. Cartoes (`/cartoes`, condicional)
5. Investir (`/investimentos`)
6. Economia (`/economia`)
7. Configuracoes (`/configuracoes`)

As rotas de mes usam `?mes=YYYY-MM`. Relatorios usa `?periodo=semana|mes|ano`
ou `?periodo=custom&de=YYYY-MM-DD&ate=YYYY-MM-DD`.

## 6. Especificacao de telas

### 6.1 Autenticacao

Telas existentes:

- Login: e-mail e senha.
- Cadastro: nome, e-mail e senha.
- Recuperar senha: e-mail.
- Redefinir senha: nova senha com token; sem token mostra "Link invalido".

Layout:

- fundo global;
- card central com largura maxima de aproximadamente 448 px;
- marca ou eyebrow "Controle Financeiro";
- titulo de 24 px;
- subtitulo orientado a tarefa;
- labels sempre visiveis;
- CTA verde em largura total;
- links secundarios no rodape, com wrap.

Interacoes:

- botao desabilitado durante request e texto "Aguarde...";
- login/cadastro redirecionam para `/`;
- recuperar e redefinir mostram mensagem de status;
- erro usa `role=alert` e vermelho com texto explicativo;
- preservar o e-mail digitado quando houver erro;
- senha com `autocomplete` adequado;
- nao revelar se um e-mail existe na recuperacao.

Estados:

- loading: CTA com spinner e sem dupla submissao;
- error: "E-mail ou senha invalidos.", dados invalidos ou indisponibilidade;
- success: mensagem de instrucoes ou senha redefinida;
- invalid link: card dedicado com CTA para solicitar novo link.

### 6.2 Dashboard / Resumo

Cabecalho:

- titulo "Resumo";
- subtitulo com mes, dia corrente e progresso do mes;
- CTA "Novo lancamento".

Ordem visual existente, que deve ser preservada:

1. alerta de contas vencidas;
2. quatro stat cards:
   - Entradas;
   - Saidas;
   - Saldo do mes;
   - Livre de verdade;
3. saldos por conta;
4. regra 50/30/20 e proximas contas;
5. maiores gastos por categoria e ultimos lancamentos;
6. atalho "Onde da para economizar".

Regras de apresentacao:

- "Livre de verdade" subtrai contas em aberto e deve ser tratado como KPI de
  decisao, nao apenas saldo bruto;
- valores positivos usam verde + sinal/icone;
- valores negativos usam vermelho + sinal/icone;
- contas vencidas aparecem no topo com faixa vermelha, icone e link "Ver contas";
- barras de progresso sempre possuem label acessivel;
- listas truncam apenas descricoes, nunca valores ou status.

Empty states:

- sem saidas: "Nenhuma saida neste mes";
- sem contas em aberto: "Nada em aberto neste mes";
- sem categorias: "Sem gastos lancados";
- sem lancamentos: orientar com exemplo "mercado 152,30".

### 6.3 Relatorios e lancamentos

`/lancamentos` e legado; a experiencia atual e `/relatorios` mais o popup global.

Relatorios:

- cabecalho "Relatorios" + CTA "Novo lancamento";
- seletor Semana / Mes / Ano;
- intervalo customizado De / Ate + Aplicar;
- quatro KPIs: Entradas, Saidas, Saldo do periodo, Media por dia;
- graficos de categoria e tendencia;
- divisao 50/30/20;
- por forma de pagamento;
- por conta/cartao;
- renda por empresa;
- lista de lancamentos com busca, filtro por categoria e saldo filtrado.

Lançamento rapido:

- abrir modal nativo `<dialog>`;
- tabs "Rapido" e "Detalhado";
- rapido aceita uma linha por lancamento:
  `mercado 152,30`, `+salario 5400`, `tenis 380 4x`;
- botao "Interpretar" antes de "Salvar";
- revisao mostra categoria sugerida, confianca, data, natureza, forma e conta;
- baixa confianca fica destacada em amarelo;
- permitir corrigir a categoria e aprender a correcao;
- ao salvar, mostrar sucesso por um curto periodo antes de fechar.

Lançamento detalhado:

- tipo Entrada/Saida;
- natureza: a vista, custo fixo, parcelado;
- descricao, valor, data e categoria;
- parcelamento com total ou valor da parcela e pre-visualizacao centavo a centavo;
- forma de pagamento filtra contas compativeis;
- data futura vira compromisso e deixa origem opcional;
- custo fixo pode cadastrar tambem em Contas a pagar;
- entrada pode apontar conta e fonte de renda;
- observacao opcional.

Regras criticas:

- se nao houver conta/cartao, bloquear o lancamento e levar para Configuracoes;
- nunca salvar interpretacao automatica sem revisao;
- excluir compra parcelada deve confirmar que todas as parcelas serao removidas;
- intervalo invertido deve ser corrigido ou bloqueado com mensagem clara.

### 6.4 Contas a pagar

Cabecalho:

- titulo "Contas a pagar";
- explicacao: contas fixas, boletos e faturas; contas bancarias ficam em
  Configuracoes;
- MonthNav com mes anterior, mes atual e mes seguinte.

KPIs:

- Em aberto;
- Vencidas;
- Ja pago no mes.

Layout desktop:

- lista de contas com aproximadamente 60% da largura;
- formulario "Cadastrar conta" com aproximadamente 40%.

Formulario:

- tipo: conta fixa mensal ou boleto avulso;
- nome;
- valor;
- dia do vencimento ou data completa, conforme tipo;
- categoria;
- linha digitavel opcional;
- checkbox de valor variavel.

Lista:

- cada linha mostra categoria, nome, data, valor, badge de status e acoes;
- badges: paga, vence hoje, vencida, a vencer;
- vencida recebe borda esquerda e fundo vermelho suave;
- copiar linha digitavel mostra check temporario;
- "Pagar" expande inline para escolher conta de origem e valor pago;
- fatura de cartao mostra explicacao de que quitar e transferencia, nao gasto novo;
- lancamento agendado atualiza a linha, nao cria duplicata;
- pagamento desfeito usa icone Undo;
- exclusao exige segunda confirmacao inline.

Empty state:

"Nada a pagar neste mes" com explicacao e convite para cadastrar conta fixa.

### 6.5 Cartoes de credito

Embora seja uma rota condicional na navegacao, e uma tela importante do produto.

- seletor de cartao aparece somente quando ha mais de um;
- card principal com fatura do mes, total em aberto e limite disponivel;
- barra de limite com semantica positiva, aviso acima de 50% e critica acima de 80%;
- importacao de PDF com leitura local no navegador;
- revisao em tabela antes de importar;
- compras da fatura e formulario dedicado "Lançar compra no cartao".

Regras do formulario:

- tipo, forma de pagamento e cartao ja ficam definidos;
- data da compra explica em qual fatura caira;
- mostrar virada do ciclo: ate o fechamento vai para uma fatura, depois vai para a
  seguinte;
- parcelamento mostra fatura inicial e final;
- se fechamento/vencimento nao estiverem cadastrados, avisar que a compra cai na
  propria data.

Importacao:

- estado lendo PDF com spinner;
- estado de senha aparece apenas se necessario;
- erro de senha e erro de leitura em `role=alert`;
- linhas interpretadas ficam revisaveis e selecionaveis;
- mostrar total selecionado, parcelas detectadas e linhas ignoradas;
- botoes "Importar N" e "Descartar";
- sucesso limpa o preview e confirma a importacao.

### 6.6 Investimentos

Objetivo: responder quanto o dinheiro pode virar usando taxas atuais.

Cabecalho:

- titulo "Investimentos";
- subtitulo "Quanto o seu dinheiro vira, com as taxas de hoje".

Card "Taxas de referencia":

- CDI;
- Selic;
- Poupanca;
- IPCA (12m);
- cada valor com percentual, a.a. e nota curta;
- hint de origem: ao vivo, cache local ou estimativa.

Se API do Banco Central estiver indisponivel:

- faixa de aviso amarela;
- explicar que sao estimativas e nao precisao;
- nao esconder a origem dos dados.

Simulador:

- ja tenho hoje;
- vou guardar por mes;
- prazo em slider de 1 a 40 anos;
- rendimento: CDI, Selic, Poupanca ou taxa customizada;
- percentual do indice ou taxa anual, conforme opcao;
- checkbox "Mostrar em poder de compra de hoje";
- cards de resultado: valor final, depositado e juros ganhos;
- grafico de projecao com tabela equivalente;
- nota de taxa nominal, taxa real e exclusoes como IR/custodia.

O feedback do simulador deve ser imediato e client-side. Nao persistir cenarios
temporarios; persistir apenas metas.

### 6.7 Economia

Objetivo: converter historico em acoes concretas.

Cabecalho:

- titulo "Onde economizar";
- subtitulo com mes do diagnostico.

Hero de economia:

- potencial mensal identificado;
- projecao do que vira investido em cinco anos;
- icone de tendencia.

Diagnostico:

- cards de severidade critical, warning, info e success;
- cada card tem icone + titulo + explicacao + "O que fazer";
- quando aplicavel, mostrar economia mensal e valor em cinco anos;
- nunca comunicar severidade apenas por cor.

Visualizacao:

- gastos por categoria em barras horizontais ordenadas;
- evolucao mensal em linhas;
- ambos com botao "Ver tabela".

Metas:

- criar meta com nome, alvo, valor guardado e prazo;
- barra de progresso;
- valor faltante;
- estimativa de meses com aporte de referencia;
- somar valor;
- excluir com confirmacao;
- estado concluido: "Meta atingida".

Empty states:

- sem gastos: card de gastos por categoria explica que e necessario lancar dados;
- sem metas: incentivar reserva de emergencia de seis meses.

### 6.8 Configuracoes

Hub de cadastros e aparencia com abas locais:

1. Geral
2. Contas
3. Cartoes
4. Empresas
5. Categorias

As abas rolam horizontalmente no mobile e usam `role=tablist`.

Geral:

- tema claro/escuro;
- alternancia com icone sol/lua;
- persistencia local;
- label acessivel "Mudar para o tema claro/escuro".

Contas:

- lista de contas com total disponivel;
- saldo calculado, entradas/saidas do mes e cheque especial;
- formulario de nova conta/edicao;
- banco opcional via lista oficial do Banco Central;
- tipo corrente, poupanca, investimento ou dinheiro;
- saldo inicial, limite de cheque especial e cor;
- editar e excluir com confirmacao.

Cartoes:

- lista de cartoes com total em faturas;
- banco, apelido, ultimos quatro digitos, limite, dia de fechamento e vencimento;
- barra de limite;
- nunca pedir numero completo do cartao.

Empresas:

- fontes de renda por CLT, PJ ou outra;
- total recebido no mes e participacao percentual;
- cadastro e exclusao.

Categorias:

- agrupamento por Necessidades, Desejos e Poupanca;
- gasto no mes, teto mensal e barra de uso;
- novo nome, tipo, cor e teto;
- alerta de estouro acima de 100%.

## 7. Componentes e regras de interacao

### 7.1 Cards

- card estatico nao deve parecer clicavel;
- card interativo usa hover apenas em borda/sombra;
- nenhum hover deve mover o layout;
- usar padding 24 px em desktop e 16-24 px em mobile.

### 7.2 Botoes

Primario:

- verde `accent`;
- texto `on-accent`;
- verbo explicito: Salvar, Cadastrar, Pagar, Importar, Aplicar.

Secundario:

- transparente ou muted;
- borda sutil;
- usado para cancelar, filtrar, alternar tabela e acoes neutras.

Destrutivo:

- nao usar vermelho em todas as exclusoes por padrao;
- primeira acao mostra confirmacao inline, por exemplo "Excluir?";
- segunda acao executa;
- enquanto pendente, spinner e botao desabilitado.

### 7.3 Formularios

- label sempre visivel;
- hint antes do erro;
- erro junto ao campo;
- `aria-describedby` para hint/erro;
- `aria-invalid` quando invalido;
- manter valores digitados;
- campos dependentes aparecem progressivamente;
- selects devem filtrar opcoes invalidas, por exemplo cartao para credito e conta
  bancaria para Pix/debito;
- dinheiro aceita formato brasileiro `1.234,56`.

### 7.4 Modal de novo lancamento

- usar modal nativo ou equivalente acessivel;
- foco preso no modal;
- Esc fecha;
- clique no backdrop fecha;
- foco retorna ao botao de abertura;
- header do modal fica sticky quando o formulario rolar;
- modal com largura maxima aproximada de 896 px e 92vw no mobile;
- montar o formulario ao abrir para limpar rascunhos de abertura anterior.

### 7.5 Datas e periodos

- mes anterior/proximo por links reais;
- periodo de relatorio por URL;
- se data inicial > data final, bloquear Aplicar e explicar;
- manter o recorte visivel no subtitulo;
- fatura e parcela devem mostrar data de compra e data de cobranca quando forem
  diferentes.

### 7.6 Graficos

- barras horizontais para categorias;
- linha solida para entradas;
- linha tracejada para saidas;
- area e linhas distintas para nominal, real e depositado;
- eixo unico;
- tooltip com valores exatos;
- tabela equivalente alternavel;
- sem animacao de entrada;
- no mobile, reduzir densidade de labels e manter tabela rolavel.

## 8. Estados de produto

### 8.1 Loading

Implementacao atual usa principalmente Server Components, portanto nao ha
`loading.tsx` global identificado. Para o design real, criar estados previsiveis:

- primeira carga: skeleton de header, stat cards e cards de conteudo;
- navegacao entre meses/periodos: manter shell e mostrar skeleton somente na area
  de dados;
- server action: spinner no botao, texto preservado e bloqueio contra duplicidade;
- PDF: "Lendo o PDF..." com spinner;
- simulador: sem spinner; recalculo imediato.

Skeletons devem usar tons muted, sem brilho animado quando reduced motion estiver
ativo.

### 8.2 Empty

Todo empty state deve conter:

- titulo curto;
- explicacao do por que esta vazio;
- proxima acao quando houver;
- borda tracejada ou card contextual;
- nao usar ilustracao decorativa sem funcao.

Exemplos do codigo:

- nenhum lancamento;
- nenhuma conta cadastrada;
- nada a pagar;
- nenhum cartao;
- nenhuma meta;
- sem gastos no periodo.

### 8.3 Error

- erros de campo junto ao campo;
- erros de acao em faixa com icone e `role=alert`;
- mensagens em portugues, acionaveis e sem stack trace;
- problemas de API exibem origem e qualidade do dado;
- erro de senha do PDF explica que a senha nao e armazenada;
- erros de autenticacao nao devem confirmar existencia de conta;
- erro destrutivo nao deve apagar a linha nem esconder a mensagem.

### 8.4 Success

- usar faixa verde suave com icone Check;
- `role=status` e `aria-live=polite`;
- texto confirma exatamente o que mudou:
  "Lançamento salvo.", "Conta quitada.", "Fatura importada.",
  "Meta atingida.";
- em modal, mostrar sucesso antes de fechar;
- apos sucesso de formulario de cadastro, atualizar lista e preservar contexto.

## 9. Acessibilidade

Requisitos para a implementacao visual no Stitch:

- idioma `pt-BR`;
- skip link "Pular para o conteudo";
- landmarks semanticos: nav, main, header, section;
- `aria-current=page` no link ativo;
- tabs com `role=tablist`, `role=tab`, `aria-selected` e painel associado;
- focus ring visivel de 2 px com offset;
- foco nao pode depender apenas de cor;
- alvos de toque de pelo menos 44 x 44 px;
- labels visiveis e associadas por `for/id`;
- mensagens de erro com `role=alert`;
- mensagens de sucesso com `role=status`;
- progress bars com `aria-valuenow`, `aria-valuemin`, `aria-valuemax` e label;
- graficos com tabela equivalente;
- icones decorativos `aria-hidden=true`;
- texto alternativo no logo;
- cor nunca e o unico canal: usar sinal, icone, texto ou padrao de linha;
- contraste minimo de 4.5:1 para texto normal e 3:1 para texto grande;
- zoom do navegador nao deve ser bloqueado;
- rolagem horizontal somente dentro de tabelas realmente largas;
- respeitar `prefers-reduced-motion`.

Pontos de atencao para o design gerado:

- revisar contraste de badges amarelas e texto auxiliar nos dois temas;
- garantir que tabs horizontais tenham indicacao de rolagem no mobile;
- garantir que a barra inferior nao cubra FAB, conteudo ou safe area;
- garantir que campos condicionais anunciem mudanca de contexto para leitor de tela.

## 10. Responsividade por tela

### 375 px

- uma coluna;
- cabecalho quebra com CTA abaixo ou em largura total;
- bottom nav com labels de 10-11 px;
- listas empilham valor e acoes;
- tabelas rolam no card;
- modal quase em largura total;
- FAB acima da nav.

### 768 px

- dois stat cards por linha;
- formularios podem usar duas colunas apenas em blocos curtos;
- listas ainda podem quebrar linha;
- tabs mantem rolagem quando necessario.

### 1024 px

- sidebar aparece;
- conteudo assume padding maior;
- listas + formulario podem dividir 1.4fr/1fr;
- nav inferior desaparece.

### 1440 px

- quatro stat cards no dashboard;
- relatorios e economia usam duas colunas;
- manter largura maxima legivel para texto e graficos;
- nao deixar um card crescer sem limite apenas para preencher espaco.

## 11. Prompt consolidado para o Stitch

Copie o bloco abaixo como prompt unico:

```text
Crie o design real do GiroFin, um app de controle financeiro pessoal em
portugues do Brasil. Gere uma experiencia SaaS fintech confiavel, moderna,
seria e pratica, com alta densidade de dashboard, sem estetica de landing page.

Use IBM Plex Sans na interface e IBM Plex Mono em valores monetarios, percentuais,
datas tabulares e eixos. O tema escuro e o padrao: background #0F172A, cards
#192134, muted #101A34, texto #FFFFFF, texto auxiliar #94A3B8, primary #1E40AF,
secondary #3B82F6, accent/CTA #059669 com texto preto, destructive #DC2626,
texto positivo #34D399 e texto negativo #F87171. Gere tambem tema claro com
background #F8FAFC, cards #FFFFFF, texto #0F172A, primary #1D4ED8,
secondary #2563EB, accent #047857, muted #EEF2FF e texto auxiliar #475569.
Preserve contraste minimo WCAG AA. Nunca use cor como unico canal de informacao.

Use glassmorphism discreto: cards com blur de 14 px, borda de 1 px translucida,
raio 12 px e sombra media. Controles tem raio 8 px; modais 16 px. Use spacing
2, 4, 8, 12, 16, 24 e 32 px. Icones somente em SVG de um conjunto consistente,
preferencialmente Lucide. Sem emojis, sem fundos brancos puros no tema escuro,
sem hover que mova layout e sem animacoes de graficos. Respeite
prefers-reduced-motion.

Use o logo GiroFin em duas variantes: girofin-light.png sobre fundo escuro e
girofin-dark.png sobre fundo claro. O logo aparece na sidebar desktop e no topo
das telas de autenticacao.

Desktop: app shell com sidebar sticky de 240 px, logo, subtitulo "Controle
Financeiro / Organize hoje. Viva melhor.", links Resumo, Relatorios, A pagar,
Cartoes quando existir cartao, Investir, Economia e Configuracoes, e logout no
rodape. Mobile: esconder sidebar e usar bottom navigation fixa com safe area,
itens com no minimo 44x44 px, reservando espaco no conteudo. Mostrar FAB
"Novo lancamento" acima da nav.

Gere as telas e estados abaixo:

1. Login, cadastro, recuperar senha e redefinir senha: card central compacto,
labels visiveis, CTA verde, mensagens de erro/sucesso acessiveis, loading no
botao, link invalido para reset.
2. Resumo: header com mes e progresso do mes, alerta de vencidas, quatro stat
cards Entradas, Saidas, Saldo do mes e Livre de verdade; saldos por conta;
regra 50/30/20; proximas contas; maiores gastos por categoria; ultimos
lancamentos; atalho para Onde economizar.
3. Relatorios: seletor Semana/Mes/Ano e intervalo customizado, KPIs, barras
horizontais de categorias, linhas de entradas e saidas, divisao 50/30/20,
formas de pagamento, contas/cartoes, renda por empresa e lista de lancamentos
com busca, filtro e saldo filtrado.
4. Modal Novo lancamento com tabs Rapido e Detalhado. Rapido aceita linhas como
"mercado 152,30", "+salario 5400" e "tenis 380 4x"; primeiro interpreta,
depois mostra preview editavel de categoria, confianca, data, conta e natureza,
e so entao salva. Baixa confianca deve ser destacada em amarelo. Detalhado deve
suportar entrada/saida, a vista, fixo, parcelado, valor total ou parcela, data,
categoria, forma de pagamento filtrada, conta, fonte de renda, observacao e
cadastro opcional em Contas a pagar.
5. Contas a pagar: MonthNav, KPIs Em aberto/Vencidas/Ja pago no mes, lista com
badges de status, vencidas em vermelho suave, copiar linha digitavel, pagamento
inline com escolha de conta de origem, desfazer pagamento e exclusao com
confirmacao; formulario para conta fixa ou boleto avulso.
6. Cartoes: seletor de cartao, fatura do mes, total em aberto, limite disponivel,
barra de utilizacao, importacao de PDF local com senha opcional, preview em
tabela antes de importar, compras da fatura e formulario dedicado que explica
em qual fatura a compra caira conforme fechamento e vencimento.
7. Investimentos: taxas CDI, Selic, Poupanca e IPCA com indicador de origem;
aviso de estimativa quando API indisponivel; simulador com aporte inicial,
aporte mensal, prazo, taxa, percentual do indice, poder de compra de hoje;
cards de resultado e grafico/tabela de projecao.
8. Economia: potencial mensal de economia e projeccao em cinco anos; cards de
diagnostico critical/warning/info/success com icone, titulo, explicacao e
acao; graficos de categoria e evolucao; metas com progresso, falta, prazo,
somar e excluir.
9. Configuracoes com tabs Geral, Contas, Cartoes, Empresas e Categorias. Geral
tem tema claro/escuro. Contas mostram saldo calculado, tipo, banco, cheque
especial, editar/excluir. Cartoes mostram limite, ciclo, ultimos quatro digitos
e nunca pedem numero completo. Empresas separam CLT/PJ/outra. Categorias
agrupam Necessidades/Desejos/Poupanca, com cor e teto mensal.

Inclua em cada tela estados loading, empty, error e success. Loading usa
skeleton discreto ou spinner no botao. Empty states usam titulo, contexto e
proxima acao. Erros aparecem perto do campo ou em faixa com icone e role alert.
Sucessos usam faixa verde com check e role status. Inclua skeleton para troca de
mes/periodo, erro de API do Banco Central, PDF protegido por senha, nenhuma
conta, nenhum lancamento, nenhum cartao, nenhuma meta e meta atingida.

Acessibilidade obrigatoria: lang pt-BR, skip link, landmarks semanticos,
aria-current, tabs acessiveis, focus ring visivel, labels associadas, campos com
hint e aria-describedby, aria-invalid, progressbar com valores, graficos com
botao "Ver tabela", tabela rolavel no mobile, icones decorativos hidden,
contraste AA, zoom permitido, alvos de toque de 44 px ou mais, sem depender
apenas de cor e com suporte a reduced motion.

Entregue um sistema visual coerente, componentes reutilizaveis, variantes dark e
light, layouts desktop/mobile e prototipos das interacoes principais: abrir
modal, trocar tabs, alternar tema, mudar mes, aplicar periodo, interpretar e
revisar lancamento, pagar conta escolhendo origem, importar/revisar PDF e criar
meta.
```

## 12. Checklist de aceite do design gerado

- [ ] Tema escuro e claro preservam hierarquia e contraste.
- [ ] Logo correto aparece em cada tema.
- [ ] Sidebar desktop e bottom nav mobile nao cobrem conteudo.
- [ ] Dashboard responde rapidamente como esta o mes.
- [ ] Novo lancamento e alcancavel de todas as telas principais.
- [ ] Revisao existe antes de salvar automacoes e importacoes.
- [ ] Contas vencidas e limite de cartao possuem destaque acionavel.
- [ ] Todos os estados empty/error/success/loading foram desenhados.
- [ ] Graficos tem alternativa em tabela.
- [ ] Formularios exibem labels, hints, erros e loading.
- [ ] Acessibilidade e responsividade foram validadas em 375, 768, 1024 e 1440 px.
- [ ] Nenhuma tela depende apenas de cor ou hover.

# GiroFin - Documento completo de Login e Autenticacao

Este documento descreve o fluxo de autenticacao do GiroFin para UX/UI, Dev, QA,
Documentacao e Stitch. Ele separa o comportamento que ja existe dos criterios
que o design e a implementacao devem preservar.

## 1. Objetivo

Permitir que uma pessoa:

1. crie uma conta;
2. entre com email e senha;
3. permaneça autenticada por uma sessao segura;
4. saia de qualquer dispositivo;
5. recupere a senha sem revelar se um email esta cadastrado;
6. redefina a senha com um token de uso unico;
7. acesse seus dados financeiros somente dentro da propria sessao.

Tom da experiencia:

- seguro sem parecer burocratico;
- humano e direto;
- privado sem linguagem alarmista;
- claro quando uma acao foi concluida;
- nunca culpar a pessoa por errar uma senha ou perder um link.

## 2. Identidade e composicao visual

### 2.1 Marca

O shell de autenticacao deve usar:

- logo GiroFin;
- slogan: `Organize hoje. Viva melhor.`;
- tema claro e escuro;
- a mesma tipografia do app: IBM Plex Sans;
- IBM Plex Mono somente para valores ou identificadores tecnicos.

O logo deve ficar acima do cartao, centralizado em telas pequenas e alinhado a
esquerda em telas largas. O formulario nao deve herdar a sidebar do app.

### 2.2 Fundo e cartao

Tema escuro:

- fundo: `#0F172A`;
- cartao: `#192134`;
- texto principal: `#FFFFFF`;
- texto auxiliar: `#94A3B8`;
- acento: `#059669`;
- erro: `#F87171`.

Tema claro:

- fundo: `#F8FAFC`;
- cartao: `#FFFFFF`;
- texto principal: `#0F172A`;
- texto auxiliar: `#475569`;
- acento: `#047857`;
- erro: `#B91C1C`.

O cartao deve ter borda sutil, raio de 12 a 16 px e sombra discreta. Nao usar
modal para login. A pagina deve funcionar como uma tela dedicada.

### 2.3 Layout responsivo

Mobile:

- largura total com padding de 16 a 24 px;
- cartao sem excesso de margem vertical;
- campos com altura minima de 44 px;
- botao de largura total;
- links de navegacao em linhas que nao se sobreponham;
- teclado virtual nao pode esconder o botao.

Desktop:

- cartao entre 400 e 480 px de largura;
- logo e formulario centralizados verticalmente quando houver espaco;
- maximo de uma coluna;
- nenhum menu financeiro visivel antes da autenticacao.

## 3. Arquitetura de telas

Rotas:

| Rota | Funcao |
|---|---|
| `/login` | entrar na conta |
| `/cadastro` | criar uma conta |
| `/recuperar-senha` | solicitar link de redefinicao |
| `/redefinir-senha?token=...` | escolher nova senha |
| `/api/v1/auth/login` | autenticar |
| `/api/v1/auth/register` | cadastrar |
| `/api/v1/auth/logout` | encerrar sessao |
| `/api/v1/auth/forgot-password` | criar fluxo de recuperacao |
| `/api/v1/auth/reset-password` | concluir redefinicao |
| `/api/v1/me` | consultar usuario da sessao |

O shell de autenticacao deve ser separado do shell financeiro. Ele deve possuir
um unico landmark `main`, sem `Nav` principal e sem links para contas, relatorios
ou lancamentos antes do login.

## 4. Tela de login

### 4.1 Hierarquia

1. Logo GiroFin.
2. Slogan.
3. Titulo: `Entrar`.
4. Descricao: `Acesse seu controle financeiro.`
5. Campo `Email`.
6. Campo `Senha`.
7. Link `Esqueci minha senha`.
8. Botao primario `Entrar`.
9. Link secundario `Criar cadastro`.

### 4.2 Campos

Email:

- `type=email`;
- `name=email`;
- `id=email`;
- `autocomplete=email`;
- label sempre visivel;
- validacao de formato;
- nao transformar ou modificar visualmente o email digitado.

Senha:

- `type=password` por padrao;
- `name=password`;
- `id=password`;
- `autocomplete=current-password`;
- permitir mostrar/ocultar senha;
- nao bloquear gerenciadores de senha;
- nao impor regras visuais alem do necessario.

### 4.3 Estados

Inicial:

- botao habilitado;
- foco no email somente se isso nao abrir o teclado inesperadamente no mobile.

Enviando:

- desabilitar botao;
- mostrar spinner ou indicador discreto;
- texto acessivel: `Entrando...`;
- aplicar `aria-busy=true` no formulario;
- impedir duplo envio.

Sucesso:

- redirecionar para `/`;
- usar `router.replace`, nao `push`, para evitar voltar ao formulario pelo
  historico;
- atualizar o shell para refletir a sessao.

Senha incorreta ou email inexistente:

- mensagem unica: `E-mail ou senha invalidos.`;
- nao revelar qual campo esta correto;
- manter email preenchido;
- limpar a senha;
- foco deve retornar ao campo de senha.

Servico indisponivel:

- mensagem: `O servico de autenticacao esta temporariamente indisponivel.`;
- preservar os dados que nao sejam senha;
- oferecer tentativa novamente sem perder o contexto.

## 5. Tela de cadastro

Titulo: `Criar cadastro`

Descricao: `Comece seu controle financeiro privado.`

Campos:

1. Nome
   - 2 a 80 caracteres;
   - `autocomplete=name`.
2. Email
   - email valido;
   - normalizado para minusculas no servidor;
   - `autocomplete=email`.
3. Senha
   - 10 a 200 caracteres;
   - `autocomplete=new-password`;
   - mostrar requisitos antes do envio.
4. Confirmacao de senha
   - obrigatoria no cliente;
   - nao enviar a confirmacao para o servidor;
   - impedir envio quando nao coincidir.

Botao: `Criar cadastro`.

Sucesso:

- criar sessao automaticamente;
- redirecionar para `/`;
- mostrar uma saudacao curta no dashboard.

Email ja cadastrado:

- mensagem neutra: `Nao foi possivel concluir o cadastro.`;
- opcionalmente oferecer `Entrar` e `Esqueci minha senha`;
- nao expor dados internos do banco.

## 6. Recuperacao de senha

### 6.1 Solicitacao

Rota: `/recuperar-senha`

Titulo: `Recuperar senha`

Descricao: `Enviaremos um link se o email estiver cadastrado.`

Campo:

- email com label visivel;
- `autocomplete=email`.

Resposta de sucesso deve ser sempre generica:

`Se o email estiver cadastrado, voce recebera instrucoes para redefinir a senha.`

Essa resposta deve ser igual para email existente e inexistente, evitando
enumeracao de contas.

### 6.2 Link invalido

Se `/redefinir-senha` nao receber token:

- nao exibir o formulario de nova senha;
- titulo: `Link invalido`;
- explicar que o link esta ausente ou expirado;
- CTA: `Solicitar novo link`;
- link secundario: `Voltar para entrar`.

### 6.3 Nova senha

Rota: `/redefinir-senha?token=...`

Campos:

- nova senha;
- confirmacao da nova senha;
- `autocomplete=new-password`;
- indicador de requisitos.

Token:

- nunca aparecer em texto visivel;
- nunca ser armazenado em localStorage;
- ser enviado apenas por HTTPS;
- ser invalidado apos uso;
- expirar em 60 minutos;
- invalidar sessoes antigas apos troca de senha.

Sucesso:

- mostrar `Senha redefinida.`;
- oferecer CTA direto `Entrar`;
- nao deixar a pessoa presa no formulario.

Erro:

- `Link invalido ou expirado.`;
- CTA para solicitar novo link.

## 7. Sessao e logout

### 7.1 Cookie

O servidor deve criar um cookie de sessao:

- HttpOnly;
- SameSite=Lax;
- Secure em producao;
- Path `/`;
- validade de 30 dias;
- token aleatorio, nunca o ID do usuario;
- somente o hash do token armazenado no banco.

Em producao, preferir nome com prefixo `__Host-`, sem Domain e com Path `/`.

### 7.2 Logout

O logout deve estar disponivel no menu do app:

- icone de saida;
- label `Sair`;
- confirmacao visual de carregamento `Saindo...`;
- chamada `POST /api/v1/auth/logout`;
- apagar a sessao no banco;
- remover o cookie;
- redirecionar para `/login`;
- impedir retorno acidental ao conteudo protegido.

## 8. Protecao das paginas

Quando autenticacao estiver configurada:

- paginas financeiras devem exigir sessao;
- usuario sem sessao deve ser redirecionado para `/login`;
- depois do login, pode retornar a rota originalmente solicitada;
- APIs protegidas devem retornar `401`, nunca dados vazios como se fossem
  sucesso;
- server actions devem validar a sessao no servidor, nao confiar no cliente.

Quando a autenticacao nao estiver configurada em desenvolvimento local, o app
pode operar em modo local explicitamente documentado. Esse comportamento nao
deve ser usado para producao.

## 9. Persistencia e isolamento

Cada usuario deve possuir dados financeiros isolados:

- contas;
- cartoes;
- categorias;
- lancamentos;
- contas a pagar;
- metas;
- relatorios;
- preferencias.

O `user_id` deve ser aplicado nas consultas e escritas. Nunca confiar em um
`user_id` vindo do browser. O servidor deve obter o usuario da sessao.

## 10. Contratos da API

### POST `/api/v1/auth/login`

Request:

```json
{
  "email": "pessoa@example.com",
  "password": "senha-temporaria"
}
```

Sucesso: `200`

```json
{
  "user": {
    "id": "uuid",
    "email": "pessoa@example.com",
    "name": "Pessoa",
    "emailVerified": false
  }
}
```

Credenciais invalidas: `401`.

Payload invalido: `400`.

Falha de infraestrutura: `503`.

### POST `/api/v1/auth/register`

Request:

```json
{
  "name": "Pessoa",
  "email": "pessoa@example.com",
  "password": "senha-com-dez-ou-mais"
}
```

Sucesso: `201`, com sessao criada.

Duplicidade: `409` ou mensagem neutra equivalente.

### POST `/api/v1/auth/logout`

Sem body. Retorna `200` mesmo se a sessao ja estiver ausente, para manter a
operacao idempotente.

### GET `/api/v1/me`

Sessao valida: `200` com usuario.

Sem sessao: `401`.

### POST `/api/v1/auth/forgot-password`

Request:

```json
{
  "email": "pessoa@example.com"
}
```

Resposta de sucesso sempre generica: `200`.

### POST `/api/v1/auth/reset-password`

Request:

```json
{
  "token": "token-recebido-no-link",
  "password": "nova-senha-com-dez-ou-mais"
}
```

Token invalido ou expirado: `400`.

## 11. Configuracao de ambiente

Obrigatorias para autenticacao:

```text
DATABASE_URL=
AUTH_SECRET=
```

Recomendadas:

```text
DATABASE_POOL_MAX=5
DATABASE_SSL=true
APP_ENV=staging
APP_URL=https://dominio-do-ambiente
```

Recuperacao de senha em ambiente real:

```text
EMAIL_FROM=
RESEND_API_KEY=
```

Nunca colocar valores reais em `.env.example`, commits, screenshots, issues ou
documentacao publica.

## 12. Banco de autenticacao

Tabelas:

- `app_users`: identidade, email, nome e hash da senha;
- `app_sessions`: sessoes ativas com hash do token e expiracao;
- `password_reset_tokens`: tokens de redefinicao, validade e uso.

Senha:

- usar scrypt ou algoritmo de derivacao equivalente;
- salt unico por senha;
- nunca salvar senha em texto;
- nunca logar senha ou token.

Email:

- normalizar espacos e caixa;
- manter limite maximo de 254 caracteres;
- consultas sempre parametrizadas.

## 13. Seguranca obrigatoria

- HTTPS em staging e producao;
- rate limit para login;
- rate limit para recuperacao;
- protecao contra brute force;
- respostas genericas para existencia de email;
- logs sem senha, cookie ou token;
- `DATABASE_SSL` validado corretamente;
- nao usar `rejectUnauthorized: false` em producao sem justificativa;
- invalidar sessoes ao trocar senha;
- rotacionar `AUTH_SECRET` com plano de migracao;
- nao aceitar `user_id` do cliente para escolher banco financeiro.

## 14. QA manual

### Cadastro

- nome vazio;
- nome com menos de 2 caracteres;
- email invalido;
- senha com menos de 10 caracteres;
- confirmacao diferente;
- cadastro valido;
- email duplicado com caixa diferente;
- refresh apos cadastro.

### Login

- campos vazios;
- email invalido;
- senha errada;
- email inexistente;
- credencial valida;
- duplo clique;
- refresh apos login;
- abrir rota protegida sem sessao;
- voltar no navegador depois do login.

### Logout

- sair com sessao valida;
- sair com sessao expirada;
- confirmar redirecionamento;
- tentar abrir dashboard depois de sair;
- confirmar `GET /api/v1/me` como `401`.

### Recuperacao

- email existente;
- email inexistente;
- email invalido;
- falha do provedor de email;
- token expirado;
- token usado duas vezes;
- senha nova valida;
- senha nova invalida;
- sessoes antigas invalidadas.

### Acessibilidade

- navegar tudo por teclado;
- foco visivel;
- labels anunciadas;
- erros anunciados por leitor de tela;
- `aria-busy` durante envio;
- alvo de toque minimo de 44 px;
- zoom de 200% sem perda de conteudo;
- contraste em tema claro e escuro.

## 15. Criterios de aceite

O fluxo sera considerado pronto quando:

1. uma pessoa conseguir criar conta e entrar sem ajuda;
2. credenciais invalidas nao revelarem informacao sensivel;
3. a sessao sobreviver a um refresh;
4. logout invalidar o cookie e a sessao no banco;
5. nenhuma rota financeira expuser dados sem sessao configurada;
6. dois usuarios nao compartilharem dados financeiros;
7. recuperacao funcionar com token unico e expiracao;
8. tema claro e escuro forem legiveis;
9. todos os estados de erro e sucesso forem anunciados;
10. QA validar os cenarios em staging;
11. documentacao registrar variaveis e resultado do teste;
12. a promocao seguir `develop -> staging -> PR develop para Master`.

## 16. Prompt consolidado para o Stitch

Crie o design completo do fluxo de autenticacao do GiroFin, um app brasileiro
de controle financeiro pessoal. O produto deve parecer uma fintech pessoal
confiavel, moderna, clara e pratica, sem estetica corporativa fria e sem
excesso de gradientes. Use o logo GiroFin e o slogan "Organize hoje. Viva
melhor.". Gere tema claro e escuro, com IBM Plex Sans, cartoes discretos,
bordas suaves, alto contraste e responsividade real.

Crie as telas `/login`, `/cadastro`, `/recuperar-senha` e
`/redefinir-senha?token=...` em um shell de autenticacao separado da area
financeira. Nao mostre a sidebar financeira antes do login. No mobile use uma
coluna com padding de 16 a 24 px; no desktop use um cartao de 400 a 480 px.
Inclua logo, slogan, titulo, descricao, campos com labels, autocomplete,
mostrar/ocultar senha, botoes de 44 px ou mais, links claros e navegacao por
teclado.

Modele todos os estados: inicial, foco, preenchido, erro por campo, erro geral,
carregando, sucesso, email ja cadastrado, credencial invalida, servico
indisponivel, link expirado, token usado, senha fraca e confirmacao diferente.
Use mensagens humanas em portugues do Brasil. Erros devem ter role alert e
sucessos role status. O loading deve bloquear duplo envio e informar leitores
de tela.

No cadastro, use nome, email, senha e confirmacao. No login, email e senha,
link de esqueci minha senha e link para criar cadastro. Na recuperacao, mostre
resposta generica que nao revele se o email existe. Na redefinicao, mostre
estado de link invalido quando nao houver token e ofereca solicitar novo link.
Depois da troca, ofereca voltar para entrar.

Crie tambem o menu autenticado com botao Sair, estados de sessao expirada e
redirecionamento para login. Mostre uma especificacao visual e de interacao
para cada estado, incluindo dimensoes, espacamento, hierarquia, foco, teclado,
contraste, leitor de tela, responsividade e comportamento de erro. O resultado
deve ser implementavel por componentes React e nao apenas uma tela decorativa.

/**
 * Bootstrap dos testes.
 *
 * `server-only` é um pacote que existe só para EXPLODIR quando importado do
 * lugar errado — é a proteção que impede o código de banco vazar para o
 * bundle do cliente. Fora do runtime do Next ele não sabe distinguir "cliente"
 * de "script de teste" e explode do mesmo jeito.
 *
 * A saída é registrar um módulo vazio no cache do require ANTES de carregar o
 * teste: quando categorize.js pedir "server-only", recebe o stub e segue. Nada
 * do código de produção muda para o teste rodar.
 */
const resolved = require.resolve("server-only");
require.cache[resolved] = {
  id: resolved,
  filename: resolved,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
};

require("../.test-build/scripts/test-lib.js");

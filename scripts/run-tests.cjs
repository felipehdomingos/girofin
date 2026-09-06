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

/*
 * Banco próprio para os testes, longe do seu.
 *
 * O teste da fatura CRIA contas e lançamentos. Rodando contra data/financeiro.db
 * ele encheria seu banco real de "Cartao teste" a cada execução.
 */
const path = require("node:path");
const fs = require("node:fs");
const dbTeste = path.join(__dirname, "..", ".test-build", "teste.db");
for (const sufixo of ["", "-wal", "-shm"]) {
  fs.rmSync(dbTeste + sufixo, { force: true });
}
process.env.FINANCEIRO_DB = dbTeste;

require("../.test-build/scripts/test-lib.js");
// Ciclo da fatura do cartão: compra -> aparece em Contas a pagar -> pagamento
// como transferência, sem contar duas vezes no mês.
require("../.test-build/scripts/test-fatura.js");
// Leitura de fatura de cartão: texto -> lançamentos, sem depender de PDF.
require("../.test-build/scripts/test-invoice.js");

const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

if (!process.env.DATABASE_URL) {
  throw new Error("npm test exige DATABASE_URL apontando para um PostgreSQL de teste.");
}

async function main() {
  // Os testes executam a lógica de servidor diretamente no Node, fora do
  // bundler do Next. Nesse contexto, `server-only` é apenas uma salvaguarda
  // de build e precisa ser neutralizado explicitamente.
  require.cache[require.resolve("server-only")] = { exports: {} };
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  const userId = randomUUID();
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "db", "postgres-schema.sql"), "utf8"));
    await client.query(
      "INSERT INTO app_users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
      [userId, `test-${userId}@invalid.local`, "test-only", "Test Runner"],
    );
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-only-secret";
    const { setFinanceUserContext } = require("../.test-build/src/lib/db.js");
    setFinanceUserContext(userId);
    const { ensureFinanceSeedData } = require("../.test-build/src/lib/finance-pg-db.js");
    await ensureFinanceSeedData();
    globalThis.__testPromises = [];
    require("../.test-build/scripts/test-lib.js");
    require("../.test-build/scripts/test-fatura.js");
    require("../.test-build/scripts/test-invoice.js");
    require("../.test-build/scripts/test-amarracao.js");
    await Promise.all(globalThis.__testPromises);
  } finally {
    await client.query("DELETE FROM app_users WHERE id = $1", [userId]);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

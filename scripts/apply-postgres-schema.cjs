const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Defina DATABASE_URL antes de aplicar o schema.");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const schema = fs.readFileSync(path.join(process.cwd(), "db", "postgres-schema.sql"), "utf8");
    await client.query(schema);
    console.log("Schema PostgreSQL aplicado.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

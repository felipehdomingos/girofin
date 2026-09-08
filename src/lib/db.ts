import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Usuário das consultas financeiras fora de um request — testes e scripts, que
 * chamam o repositório direto no Node e definem o dono na mão, no topo do
 * processo.
 *
 * Num request quem manda é a sessão, resolvida em `finance-user.ts`. Não adianta
 * empurrar o usuário para cá de dentro de uma page: `enterWith` só alcança a
 * continuação de quem chama, e todo chamador aqui grava depois de um `await`.
 */
const financeUserContext = new AsyncLocalStorage<string>();

export function setFinanceUserContext(userId: string): void {
  if (!userId) throw new Error("Usuário financeiro inválido.");
  financeUserContext.enterWith(userId);
}

export function getFinanceUserContext(): string | undefined {
  return financeUserContext.getStore();
}

export function newId(): string {
  return randomUUID();
}

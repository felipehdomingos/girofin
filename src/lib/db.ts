import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Contexto obrigatório do usuário para todas as consultas financeiras. */
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

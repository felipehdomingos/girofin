import { redirect } from "next/navigation";

/**
 * Rota antiga. O cadastro de bancos e empresas virou aba dentro de
 * /configuracoes â€” este redirect existe para nÃ£o quebrar link salvo nem
 * histÃ³rico do navegador.
 */
export default function Page() {
  redirect("/configuracoes");
}


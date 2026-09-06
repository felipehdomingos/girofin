import { redirect } from "next/navigation";

/**
 * Rota antiga. O cadastro de bancos e empresas virou aba dentro de
 * /configuracoes — este redirect existe para não quebrar link salvo nem
 * histórico do navegador.
 */
export default function Page() {
  redirect("/configuracoes");
}

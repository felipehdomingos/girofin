import { redirect } from "next/navigation";

/**
 * Rota antiga. As categorias viraram aba dentro de /configuracoes — este
 * redirect existe para não quebrar link salvo nem histórico do navegador.
 */
export default function Page() {
  redirect("/configuracoes");
}


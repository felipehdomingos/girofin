import { redirect } from "next/navigation";

/**
 * Rota antiga. As categorias viraram aba dentro de /configuracoes â€” este
 * redirect existe para nÃ£o quebrar link salvo nem histÃ³rico do navegador.
 */
export default function Page() {
  redirect("/configuracoes");
}


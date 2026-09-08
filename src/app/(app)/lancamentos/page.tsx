import { redirect } from "next/navigation";

/**
 * Rota antiga. A tela "LanÃ§ar" virou sÃ³ uma lista depois que o lanÃ§amento
 * passou a ser um popup acessÃ­vel de qualquer tela â€” o extrato foi para
 * RelatÃ³rios, dentro do perÃ­odo escolhido. Redirect para nÃ£o quebrar link
 * salvo nem histÃ³rico.
 */
export default function Page() {
  redirect("/relatorios");
}

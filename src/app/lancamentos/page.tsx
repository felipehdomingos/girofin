import { redirect } from "next/navigation";

/**
 * Rota antiga. A tela "Lançar" virou só uma lista depois que o lançamento
 * passou a ser um popup acessível de qualquer tela — o extrato foi para
 * Relatórios, dentro do período escolhido. Redirect para não quebrar link
 * salvo nem histórico.
 */
export default function Page() {
  redirect("/relatorios");
}
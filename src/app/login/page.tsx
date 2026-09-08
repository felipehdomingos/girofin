import { AuthForm } from "@/components/auth-form";

/**
 * Mensagens do `?error=` que o callback do Google usa ao redirecionar de volta.
 *
 * Sem isto o parâmetro era simplesmente ignorado: falha de OAuth virava "cliquei
 * e não aconteceu nada", sem nada na tela dizendo o que houve nem o que fazer.
 * Os textos são propositalmente genéricos — o detalhe técnico fica no log do
 * servidor, não no navegador de quem tentou entrar.
 */
const GOOGLE_ERRORS: Record<string, string> = {
  google_state: "A sessão do login com Google expirou. Tente novamente.",
  google_token: "O Google não confirmou o acesso. Tente novamente.",
  google_profile: "Não foi possível validar sua conta do Google. Use e-mail e senha.",
  google_unavailable: "O login com Google está indisponível agora. Use e-mail e senha.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  return <AuthForm mode="login" initialError={error ? GOOGLE_ERRORS[error] ?? "" : ""} initialMessage={message ?? ""} />;
}

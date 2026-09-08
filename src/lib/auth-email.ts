import "server-only";

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  token: string;
}): Promise<void> {
  const appUrl = process.env.APP_URL;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_NO_REPLY ?? process.env.EMAIL_FROM;
  const supportEmail = process.env.SUPPORT_EMAIL;

  /*
   * `appUrl` faz parte da guarda porque o link do e-mail depende dele. Sem
   * isso, com Resend configurado e APP_URL ausente, o e-mail saía com
   * "undefined/redefinir-senha?token=..." e queimava um token de uso único —
   * a recuperação ficava inutilizável sem erro nenhum no servidor.
   */
  if (!apiKey || !from || !appUrl) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[auth] password reset for ${input.email}: ${appUrl ?? "http://localhost:3000"}/redefinir-senha?token=${input.token}`,
      );
      return;
    }
    throw new Error("Serviço de e-mail não configurado (RESEND_API_KEY, remetente e APP_URL).");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      ...(supportEmail ? { reply_to: supportEmail } : {}),
      subject: "Redefinição de senha · Controle Financeiro",
      text:
        `Olá, ${input.name}.\n\n` +
        `Use este link para redefinir sua senha (válido por 1 hora):\n` +
        `${appUrl}/redefinir-senha?token=${input.token}\n\n` +
        "Se você não pediu isso, ignore este e-mail.",
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao enviar e-mail de recuperação (${response.status}).`);
  }
}

export async function sendEmailVerification(input: {
  email: string;
  name: string;
  code: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_NO_REPLY ?? process.env.EMAIL_FROM;
  const supportEmail = process.env.SUPPORT_EMAIL;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth] email verification code for ${input.email}: ${input.code}`);
      return;
    }
    throw new Error("Serviço de e-mail não configurado.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.email],
      ...(supportEmail ? { reply_to: supportEmail } : {}),
      subject: "Seu código de confirmação · GiroFin",
      text:
        `Olá, ${input.name}.\n\n` +
        `Seu código de confirmação do GiroFin é: ${input.code}\n\n` +
        "Esse código expira em 10 minutos. Se você não criou esta conta, ignore este e-mail.",
    }),
  });

  if (!response.ok) throw new Error(`Falha ao enviar e-mail de confirmação (${response.status}).`);
}

/**
 * Enviado quando alguém tenta cadastrar um e-mail que já tem conta confirmada.
 *
 * Existe para que a rota de cadastro possa responder sempre a mesma coisa. Quem
 * só estava testando o endereço não descobre nada pela resposta HTTP; o dono da
 * caixa recebe a orientação certa.
 */
export async function sendAccountExistsEmail(input: { email: string }): Promise<void> {
  const appUrl = process.env.APP_URL;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_NO_REPLY ?? process.env.EMAIL_FROM;
  const supportEmail = process.env.SUPPORT_EMAIL;

  if (!apiKey || !from || !appUrl) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth] tentativa de cadastro em e-mail ja existente: ${input.email}`);
      return;
    }
    throw new Error("Serviço de e-mail não configurado.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.email],
      ...(supportEmail ? { reply_to: supportEmail } : {}),
      subject: "Você já tem conta no GiroFin",
      text:
        "Olá.\n\n" +
        "Alguém tentou criar uma conta no GiroFin com este e-mail, mas você já tem uma.\n\n" +
        `Para entrar: ${appUrl}/login\n` +
        `Se esqueceu a senha: ${appUrl}/recuperar-senha\n\n` +
        "Se não foi você, pode ignorar este e-mail — nada foi alterado na sua conta.",
    }),
  });

  if (!response.ok) throw new Error(`Falha ao enviar aviso de conta existente (${response.status}).`);
}

import "server-only";

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  token: string;
}): Promise<void> {
  const appUrl = process.env.APP_URL;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!appUrl || !apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[auth] password reset for ${input.email}: ${appUrl ?? "http://localhost:3000"}/redefinir-senha?token=${input.token}`,
      );
      return;
    }
    throw new Error("Serviço de e-mail não configurado.");
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
      subject: "Redefinição de senha · GiroFin",
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

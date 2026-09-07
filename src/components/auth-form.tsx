"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";

type Mode = "login" | "register" | "forgot" | "reset";

export function AuthForm({ mode, token = "" }: { mode: Mode; token?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const copy = {
    login: ["Entrar", "Acesse seu controle financeiro."],
    register: ["Criar cadastro", "Comece seu controle financeiro privado."],
    forgot: ["Recuperar senha", "Enviaremos um link se o e-mail estiver cadastrado."],
    reset: ["Nova senha", "Escolha uma senha forte para continuar."],
  }[mode];

  if (mode === "reset" && !token) {
    return (
      <main className="auth-shell flex min-h-dvh items-center justify-center px-xl py-3xl">
      <div className="auth-wrap w-full">
        <div className="auth-brand"><BrandLogo /></div>
      <section className="glass auth-card w-full p-2xl" aria-labelledby="reset-invalid">
          <h1 id="reset-invalid" className="text-2xl font-semibold">
            Link inválido
          </h1>
          <p className="mt-sm text-sm text-muted-foreground">
            Esse link de redefinição está ausente ou expirado. Solicite um novo link para continuar.
          </p>
          <Link
            href="/recuperar-senha"
            className="mt-xl inline-flex min-h-11 items-center rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent"
          >
            Solicitar novo link
          </Link>
        </section>
      </div>
      </main>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const endpoint = {
      login: "/api/v1/auth/login",
      register: "/api/v1/auth/register",
      forgot: "/api/v1/auth/forgot-password",
      reset: "/api/v1/auth/reset-password",
    }[mode];
    const body =
      mode === "register"
        ? { name, email, password }
        : mode === "forgot"
          ? { email }
          : mode === "reset"
            ? { token, password }
            : { email, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      const structuredError = (data as unknown as { error?: { message?: string } }).error;
      if (!response.ok && structuredError && typeof structuredError === "object") {
        throw new Error(structuredError.message ?? "Nao foi possivel concluir.");
      }
      if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir.");
      if (mode === "login" || mode === "register") router.push("/");
      else setMessage(data.message ?? "Operação concluída.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell flex min-h-dvh items-center justify-center px-xl py-3xl">
      <div className="auth-wrap w-full">
        <div className="auth-brand"><BrandLogo /></div>
      <section className="glass auth-card w-full p-2xl">
        <p className="mt-lg text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Controle Financeiro
        </p>
        <h1 className="mt-lg text-2xl font-semibold">{copy[0]}</h1>
        <p className="mt-sm text-sm text-muted-foreground">{copy[1]}</p>

        <form onSubmit={submit} className="mt-2xl flex flex-col gap-lg">
          {mode === "register" ? (
            <label className="flex flex-col gap-sm text-sm">
              Nome
              <input
                id="name"
                name="name"
                required
                minLength={2}
                maxLength={80}
                value={name}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-control border border-border bg-muted px-lg py-md"
              />
            </label>
          ) : null}
          {mode !== "reset" ? (
            <label className="flex flex-col gap-sm text-sm">
              E-mail
              <input
                id="email"
                name="email"
                required
                type="email"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-control border border-border bg-muted px-lg py-md"
              />
            </label>
          ) : null}
          {mode !== "forgot" ? (
            <label className="flex flex-col gap-sm text-sm">
              Senha
              <input
                id="password"
                name="password"
                required
                type="password"
                minLength={10}
                maxLength={200}
                value={password}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-control border border-border bg-muted px-lg py-md"
              />
              {mode !== "login" ? (
                <span className="text-xs text-muted-foreground">Use pelo menos 10 caracteres.</span>
              ) : null}
            </label>
          ) : null}
          {error ? (
            <p role="alert" aria-live="assertive" className="rounded-control bg-destructive/10 p-lg text-sm text-neg">
              {error}
            </p>
          ) : null}
          {message ? (
            <p role="status" aria-live="polite" className="rounded-control bg-accent/10 p-lg text-sm text-pos">
              {message}
            </p>
          ) : null}
          <button
            disabled={pending}
            className="rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            {pending ? "Aguarde..." : copy[0]}
          </button>
        </form>

        {mode === "login" || mode === "register" ? (
          <>
            <div className="mt-xl flex items-center gap-md text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>ou</span><span className="h-px flex-1 bg-border" /></div>
            <button type="button" onClick={() => { window.location.href = "/api/v1/auth/google/start"; }} className="mt-xl flex w-full items-center justify-center gap-md rounded-control bg-[#db4437] px-xl py-md text-sm font-semibold text-white transition-colors hover:bg-[#c23325]">
              <span aria-hidden="true" className="text-base font-bold">G</span>
              Continuar com Google
            </button>
          </>
        ) : null}

        <nav className="mt-xl flex flex-wrap gap-lg text-xs text-muted-foreground">
          {mode !== "login" ? <Link href="/login" className="underline">Entrar</Link> : null}
          {mode !== "register" ? <Link href="/cadastro" className="underline">Criar cadastro</Link> : null}
          {mode !== "forgot" && mode !== "reset" ? (
            <Link href="/recuperar-senha" className="underline">Esqueci minha senha</Link>
          ) : null}
        </nav>
      </section>
      </div>
    </main>
  );
}

"use client";

import { ChangeEvent, FormEvent, useState, useTransition } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { updateProfileAction } from "@/lib/actions";

type Profile = {
  name: string;
  email: string;
  phone?: string | null;
  birthDate?: string | null;
  city?: string | null;
  state?: string | null;
  avatarDataUrl?: string | null;
};

export function ProfileForm({ profile }: { profile: Profile }) {
  const [avatar, setAvatar] = useState(profile.avatarDataUrl ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 2 * 1024 * 1024) {
      setError("A foto deve ser JPG, PNG ou WebP e ter no máximo 2 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(typeof reader.result === "string" ? reader.result : "");
      setError("");
    };
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    data.set("avatarDataUrl", avatar);
    startTransition(async () => {
      const result = await updateProfileAction(data);
      if (!result.ok) setError(result.error);
      else setMessage(result.message ?? "Perfil atualizado com sucesso.");
    });
  }

  return (
    <form onSubmit={submit} className="glass max-w-3xl p-2xl">
      <div className="mb-2xl flex flex-wrap items-center gap-xl">
        <div className="relative">
          {avatar ? (
            // Data URL vem do próprio usuário e foi validada antes de persistir.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Prévia da foto do perfil" className="size-20 rounded-full object-cover" />
          ) : (
            <span className="grid size-20 place-items-center rounded-full bg-accent text-xl font-semibold text-on-accent">
              {profile.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <label className="absolute -bottom-1 -right-1 grid size-9 cursor-pointer place-items-center rounded-full bg-primary text-on-primary shadow-md" title="Escolher foto">
            <Camera className="size-4" aria-hidden="true" />
            <span className="sr-only">Escolher foto de perfil</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseAvatar} className="sr-only" />
          </label>
        </div>
        <div>
          <h2 className="text-base font-semibold">Seu perfil</h2>
          <p className="mt-xs text-sm text-muted-foreground">Complete seus dados para personalizar o GiroFin.</p>
          {avatar ? (
            <button type="button" onClick={() => setAvatar("")} className="mt-md inline-flex items-center gap-sm text-xs text-muted-foreground underline">
              <Trash2 className="size-3" aria-hidden="true" /> Remover foto
            </button>
          ) : null}
        </div>
      </div>

      <input type="hidden" name="avatarDataUrl" value={avatar} readOnly />
      <div className="grid gap-lg sm:grid-cols-2">
        <label className="flex flex-col gap-sm text-sm">Nome completo<input name="name" defaultValue={profile.name} required minLength={2} maxLength={80} className="rounded-control border border-border bg-muted px-lg py-md" /></label>
        <label className="flex flex-col gap-sm text-sm">E-mail<input value={profile.email} readOnly className="rounded-control border border-border bg-muted px-lg py-md opacity-70" /></label>
        <label className="flex flex-col gap-sm text-sm">Telefone<input name="phone" defaultValue={profile.phone ?? ""} maxLength={30} inputMode="tel" placeholder="(00) 00000-0000" className="rounded-control border border-border bg-muted px-lg py-md" /></label>
        <label className="flex flex-col gap-sm text-sm">Data de nascimento<input name="birthDate" type="date" defaultValue={profile.birthDate?.slice(0, 10) ?? ""} className="rounded-control border border-border bg-muted px-lg py-md" /></label>
        <label className="flex flex-col gap-sm text-sm">Cidade<input name="city" defaultValue={profile.city ?? ""} maxLength={80} className="rounded-control border border-border bg-muted px-lg py-md" /></label>
        <label className="flex flex-col gap-sm text-sm">UF<input name="state" defaultValue={profile.state ?? ""} maxLength={2} placeholder="SP" className="rounded-control border border-border bg-muted px-lg py-md uppercase" /></label>
      </div>
      {error ? <p role="alert" className="mt-lg rounded-control bg-destructive/10 p-lg text-sm text-neg">{error}</p> : null}
      {message ? <p role="status" className="mt-lg rounded-control bg-accent/10 p-lg text-sm text-pos">{message}</p> : null}
      <button type="submit" disabled={pending} className="mt-2xl inline-flex items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Salvando..." : "Salvar perfil"}
      </button>
    </form>
  );
}

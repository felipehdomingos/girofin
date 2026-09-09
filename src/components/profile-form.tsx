"use client";

import { ChangeEvent, FormEvent, useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { updateProfileAction } from "@/lib/actions";

type Profile = {
  name: string;
  email: string;
  phone?: string | null;
  birthDate?: string | null;
  cep?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  avatarDataUrl?: string | null;
};

const CAMPO = "rounded-control border border-border bg-muted px-lg py-md";

/** 00000000 -> 00000-000. Só para exibir; no banco vai só o dígito. */
function mascaraCep(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [avatar, setAvatar] = useState(profile.avatarDataUrl ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [cep, setCep] = useState(mascaraCep(profile.cep ?? ""));
  const [street, setStreet] = useState(profile.street ?? "");
  const [district, setDistrict] = useState(profile.district ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [uf, setUf] = useState(profile.state ?? "");
  const [buscandoCep, setBuscandoCep] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);

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

  /**
   * Completa o endereço pelo CEP (ViaCEP).
   *
   * Roda no navegador de propósito: é a máquina de quem está digitando que
   * fala com o ViaCEP, então o servidor não vira intermediário de um serviço
   * de terceiro nem carrega o custo dessa chamada. Falha em silêncio — CEP que
   * não responde não pode travar quem quer só salvar o telefone, e todos os
   * campos continuam editáveis à mão.
   */
  async function buscarCep(valor: string) {
    const digitos = valor.replace(/\D/g, "");
    if (digitos.length !== 8) return;
    setBuscandoCep(true);
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      if (!resposta.ok) return;
      const dados = (await resposta.json()) as {
        erro?: boolean | string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (dados.erro) {
        setError("CEP não encontrado. Preencha o endereço à mão.");
        return;
      }
      setStreet(dados.logradouro ?? "");
      setDistrict(dados.bairro ?? "");
      setCity(dados.localidade ?? "");
      setUf(dados.uf ?? "");
      setError("");
      // O CEP não traz o número: é o único campo que sobra para digitar.
      numeroRef.current?.focus();
    } catch {
      // Sem rede ou ViaCEP fora do ar: segue no preenchimento manual.
    } finally {
      setBuscandoCep(false);
    }
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
        {/*
          Sem badge de câmera sobre a foto: ícone sozinho não diz o que faz, e
          num canto de 36px vira adivinhação. O rótulo escrito embaixo resolve
          as duas coisas — diz o que é e aumenta a área de clique.
        */}
        <div className="flex flex-col items-center gap-md">
          {avatar ? (
            // Data URL vem do próprio usuário e foi validada antes de persistir.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Prévia da foto do perfil" className="size-20 rounded-full object-cover" />
          ) : (
            <span className="grid size-20 place-items-center rounded-full bg-accent text-xl font-semibold text-on-accent">
              {profile.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <label className="cursor-pointer rounded-control px-md py-sm text-xs font-semibold text-accent underline underline-offset-2 hover:bg-muted">
            Editar foto de perfil
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
        <label className="flex flex-col gap-sm text-sm">Nome completo<input name="name" defaultValue={profile.name} required minLength={2} maxLength={80} className={CAMPO} /></label>
        <label className="flex flex-col gap-sm text-sm">E-mail<input value={profile.email} readOnly className={`${CAMPO} opacity-70`} /></label>
        <label className="flex flex-col gap-sm text-sm">Telefone<input name="phone" defaultValue={profile.phone ?? ""} maxLength={30} inputMode="tel" placeholder="(00) 00000-0000" className={CAMPO} /></label>
        <label className="flex flex-col gap-sm text-sm">Data de nascimento<input name="birthDate" type="date" defaultValue={profile.birthDate?.slice(0, 10) ?? ""} className={CAMPO} /></label>
      </div>

      {/*
        Endereço completo, e não só cidade/UF, porque nota fiscal de compra
        precisa de logradouro, número e bairro. Começa pelo CEP: é um campo só
        para preencher quatro.
      */}
      <fieldset className="mt-2xl">
        <legend className="text-sm font-semibold">Endereço</legend>
        <p className="mt-xs text-xs text-muted-foreground">
          Digite o CEP que o resto se preenche sozinho. Serve para emitir nota
          fiscal das suas compras.
        </p>

        <div className="mt-lg grid gap-lg sm:grid-cols-6">
          <label className="flex flex-col gap-sm text-sm sm:col-span-2">
            CEP
            <span className="relative">
              <input
                name="cep"
                value={cep}
                onChange={(e) => {
                  const mascarado = mascaraCep(e.target.value);
                  setCep(mascarado);
                  // Dispara sozinho no oitavo dígito: ninguém deveria precisar
                  // apertar "buscar" depois de digitar o CEP inteiro.
                  if (mascarado.replace(/\D/g, "").length === 8) void buscarCep(mascarado);
                }}
                onBlur={(e) => void buscarCep(e.target.value)}
                inputMode="numeric"
                placeholder="00000-000"
                className={`${CAMPO} w-full font-mono`}
              />
              {buscandoCep ? (
                <Loader2 className="absolute right-lg top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : null}
            </span>
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-4">
            Logradouro
            <input name="street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={120} placeholder="Rua, avenida, travessa…" className={CAMPO} />
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-2">
            Número
            <input ref={numeroRef} name="streetNumber" defaultValue={profile.streetNumber ?? ""} maxLength={20} placeholder="123" className={CAMPO} />
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-4">
            Complemento
            <input name="complement" defaultValue={profile.complement ?? ""} maxLength={60} placeholder="Apto, bloco, fundos" className={CAMPO} />
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-3">
            Bairro
            <input name="district" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={80} className={CAMPO} />
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-2">
            Cidade
            <input name="city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className={CAMPO} />
          </label>

          <label className="flex flex-col gap-sm text-sm sm:col-span-1">
            UF
            <input name="state" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} maxLength={2} placeholder="SP" className={`${CAMPO} uppercase`} />
          </label>
        </div>
      </fieldset>

      {error ? <p role="alert" className="mt-lg rounded-control bg-destructive/10 p-lg text-sm text-neg">{error}</p> : null}
      {message ? <p role="status" className="mt-lg rounded-control bg-accent/10 p-lg text-sm text-pos">{message}</p> : null}

      <button type="submit" disabled={pending} className="mt-2xl inline-flex items-center gap-md rounded-control bg-accent px-xl py-md text-sm font-semibold text-on-accent disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Salvando..." : "Salvar perfil"}
      </button>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pipette } from "lucide-react";

/**
 * Cor: sugestões primeiro, liberdade depois.
 *
 * As amostras da paleta continuam, porque na maior parte das vezes a pessoa só
 * quer uma cor que funcione — e essas já foram validadas para contraste e
 * daltonismo. Mas elas ficaram menores e deixaram de ser o único caminho: ao
 * lado entra a roda, para quem quer a cor da empresa dele, e não a nossa.
 *
 * A roda é ponteiro puro, então sozinha ela excluiria quem navega por teclado.
 * Os três controles deslizantes abaixo são o mesmo estado por outro caminho, e
 * o campo hexadecimal fecha para quem já tem o código da cor na mão.
 */

/** h 0-360, s 0-100, l 0-100. */
function hslParaHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const canal = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`;
}

function hexParaHsl(hex: string): { h: number; s: number; l: number } {
  const limpo = hex.replace("#", "");
  if (limpo.length !== 6) return { h: 0, s: 70, l: 50 };
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function Deslizante({
  rotulo,
  valor,
  max,
  onChange,
  trilha,
}: {
  rotulo: string;
  valor: number;
  max: number;
  onChange: (v: number) => void;
  trilha: string;
}) {
  return (
    <label className="flex items-center gap-md text-[11px] text-muted-foreground">
      <span className="w-16 shrink-0">{rotulo}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: trilha }}
      />
      <span className="w-8 shrink-0 text-right font-mono">{valor}</span>
    </label>
  );
}

function Roda({
  hsl,
  aplicar,
}: {
  hsl: { h: number; s: number; l: number };
  aplicar: (h: number, s: number, l: number) => void;
}) {
  const discoRef = useRef<HTMLDivElement>(null);
  const [arrastando, setArrastando] = useState(false);

  function escolher(clientX: number, clientY: number) {
    const el = discoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const raio = r.width / 2;
    const x = clientX - r.left - raio;
    const y = clientY - r.top - raio;
    // Ângulo com 0° no topo, crescendo no sentido horário — é como a roda é
    // desenhada pelo conic-gradient, então os dois têm de concordar.
    const angulo = ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
    const distancia = Math.min(Math.hypot(x, y) / raio, 1);
    aplicar(Math.round(angulo), Math.round(distancia * 100), hsl.l);
  }

  // O ponteiro pode sair do disco no meio do arrasto; escutar no documento
  // evita a cor congelar quando isso acontece.
  useEffect(() => {
    if (!arrastando) return;
    const mover = (e: PointerEvent) => escolher(e.clientX, e.clientY);
    const soltar = () => setArrastando(false);
    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
    return () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
    };
  });

  const anguloRad = ((hsl.h - 90) * Math.PI) / 180;
  const raioSelecao = (hsl.s / 100) * 50;

  return (
    <div
      ref={discoRef}
      onPointerDown={(e) => {
        setArrastando(true);
        escolher(e.clientX, e.clientY);
      }}
      /* Ponteiro só. Quem usa teclado tem os deslizantes e o campo hex logo
         abaixo, que escrevem no mesmo estado. */
      aria-hidden="true"
      className="relative size-40 shrink-0 cursor-crosshair rounded-full"
      style={{
        background: `
          radial-gradient(circle at center, hsl(0 0% ${hsl.l}%) 0%, transparent 70%),
          conic-gradient(from 0deg,
            hsl(0 100% ${hsl.l}%), hsl(60 100% ${hsl.l}%), hsl(120 100% ${hsl.l}%),
            hsl(180 100% ${hsl.l}%), hsl(240 100% ${hsl.l}%), hsl(300 100% ${hsl.l}%),
            hsl(360 100% ${hsl.l}%))
        `,
      }}
    >
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
        style={{
          left: `${50 + raioSelecao * Math.cos(anguloRad)}%`,
          top: `${50 + raioSelecao * Math.sin(anguloRad)}%`,
          backgroundColor: hslParaHex(hsl.h, hsl.s, hsl.l),
        }}
      />
    </div>
  );
}

export function ColorPicker({
  name,
  value,
  onChange,
  palette,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  name: string;
  value: string;
  onChange: (hex: string) => void;
  palette: readonly string[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const hsl = hexParaHsl(value);

  const aplicar = (h: number, s: number, l: number) => onChange(hslParaHex(h, s, l));
  const naPaleta = palette.some((hex) => hex.toLowerCase() === value.toLowerCase());

  return (
    <>
      <input type="hidden" name={name} value={value} />

      <div className="flex flex-wrap items-center gap-md">
        <div
          role="radiogroup"
          aria-label="Cores sugeridas"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          className="flex flex-wrap gap-sm"
        >
          {palette.map((hex, i) => {
            const ativa = hex.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={ativa}
                aria-label={`Cor ${i + 1}`}
                onClick={() => onChange(hex)}
                /* size-8 com o alvo estendido pelo padding do contêiner: a
                   amostra encolheu para dar lugar à roda, sem virar um alvo
                   de toque pequeno demais. */
                className={`flex size-8 cursor-pointer items-center justify-center rounded-full transition-transform duration-200 hover:scale-110 ${
                  ativa ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : ""
                }`}
                style={{ backgroundColor: hex }}
              >
                {ativa ? <Check className="size-3 text-black" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className={`inline-flex cursor-pointer items-center gap-sm rounded-control border px-md py-sm text-[11px] font-semibold transition-colors duration-200 hover:bg-muted ${
            naPaleta ? "border-border text-muted-foreground" : "border-ring text-foreground"
          }`}
        >
          <Pipette className="size-3" aria-hidden="true" />
          Outra cor
          <span
            aria-hidden="true"
            className="size-4 rounded-full border border-border"
            style={{ backgroundColor: value }}
          />
        </button>
      </div>

      {aberto ? (
        <div className="mt-lg flex flex-wrap items-center gap-xl rounded-control border border-border bg-muted/40 p-lg">
          <Roda hsl={hsl} aplicar={aplicar} />

          <div className="flex min-w-[200px] flex-1 flex-col gap-md">
            <Deslizante
              rotulo="Matiz"
              valor={hsl.h}
              max={360}
              onChange={(h) => aplicar(h, hsl.s, hsl.l)}
              trilha="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            />
            <Deslizante
              rotulo="Saturação"
              valor={hsl.s}
              max={100}
              onChange={(s) => aplicar(hsl.h, s, hsl.l)}
              trilha={`linear-gradient(to right, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`}
            />
            <Deslizante
              rotulo="Brilho"
              valor={hsl.l}
              max={100}
              onChange={(l) => aplicar(hsl.h, hsl.s, l)}
              trilha={`linear-gradient(to right, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`}
            />

            <label className="mt-sm flex items-center gap-md text-[11px] text-muted-foreground">
              <span className="w-16 shrink-0">Código</span>
              <input
                value={value}
                onChange={(e) => {
                  const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                  // Só propaga hex completo: a cada tecla o valor está pela
                  // metade, e "#12" pintaria tudo de preto no meio da digitação.
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
                }}
                maxLength={7}
                spellCheck={false}
                aria-label="Código hexadecimal da cor"
                className="w-24 rounded-control border border-border bg-card px-md py-sm font-mono text-xs uppercase"
              />
            </label>
          </div>
        </div>
      ) : null}
    </>
  );
}

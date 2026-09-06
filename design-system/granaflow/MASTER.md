# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** GranaFlow
**Generated:** 2026-09-05 20:03:34
**Category:** Personal Finance Tracker
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E40AF` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent/CTA | `#059669` | `--color-accent` |
| On Accent/CTA | `#000000` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#FFFFFF` | `--color-foreground` |
| Card | `#192134` | `--color-card` |
| Card Foreground | `#FFFFFF` | `--color-card-foreground` |
| Muted | `#101A34` | `--color-muted` |
| Muted Foreground | `#94A3B8` | `--color-muted-foreground` |
| Border | `rgba(255,255,255,0.08)` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#FFFFFF` | `--color-ring` |

**Color Notes:** Trust blue + profit green on dark

### Typography

> **OVERRIDE APLICADO.** O `--design-system` retornou o par *Caveat / Quicksand* ("handwritten,
> personal, casual — best for: personal blogs, invitations"). Resultado fora de contexto para um
> produto financeiro: fonte manuscrita destrói a leitura de valores monetários e passa o oposto
> da credibilidade que o produto precisa. Busca de verificação `--domain typography` com
> "fintech dashboard numeric data professional" retornou **Financial Trust — IBM Plex Sans**
> ("best for: banks, finance, investment, fintech"), adotado abaixo.

- **Heading Font:** IBM Plex Sans
- **Body Font:** IBM Plex Sans
- **Numeric/Money Font:** IBM Plex Mono (`font-variant-numeric: tabular-nums`)
- **Mood:** financial, trustworthy, professional, banking, serious
- **Por que mono nos valores:** colunas de dinheiro precisam alinhar dígito com dígito. Toda
  quantia renderizada em tabela, stat card ou eixo de gráfico usa `--font-mono` + `tabular-nums`.

**Carregamento:** via `next/font/google` em `src/app/layout.tsx` (self-host automático, sem
FOUT e sem requisição a `fonts.googleapis.com` em runtime) — não via `@import` CSS.

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

> **OVERRIDE APLICADO.** As specs geradas eram de light mode e contradiziam os próprios tokens
> da paleta dark acima. Três defeitos concretos, corrigidos abaixo:
>
> 1. `.btn-primary` usava `color: white` sobre `#059669` → **3,77:1**, reprova no item
>    "text contrast 4.5:1 minimum" da checklist deste mesmo arquivo. O token `--color-on-accent`
>    já dizia `#000000` (**5,57:1**, aprova). Corrigido para preto.
> 2. `.card` usava `#0F172A`, que é exatamente o `--color-background` → card invisível sobre a
>    página. Corrigido para o token `--color-card` (`#192134`).
> 3. `.input` (borda `#E2E8F0`) e `.modal` (fundo `white`) eram light mode puro sobre fundo
>    `#0F172A`. Reescritos com os tokens dark + a camada de vidro do estilo Glassmorphism.
>
> Regra geral: **componente nenhum hardcoda hex.** Tudo referencia `var(--color-*)`, que é o que
> `globals.css` define.

```css
/* Primário — ação de confirmação (salvar lançamento, aplicar plano) */
.btn-primary {
  background: var(--color-accent);
  color: var(--color-on-accent); /* #000 = 5,57:1 sobre o verde. NÃO trocar por branco. */
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  transition: background-color 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { background: color-mix(in oklab, var(--color-accent) 88%, white); }
.btn-primary:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }

/* Secundário — ação neutra (cancelar, filtrar) */
.btn-secondary {
  background: transparent;
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  transition: background-color 200ms ease;
  cursor: pointer;
}
.btn-secondary:hover { background: var(--color-muted); }
.btn-secondary:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
```

### Cards (superfície de vidro)

```css
.card {
  background: color-mix(in oklab, var(--color-card) 82%, transparent);
  backdrop-filter: blur(14px);           /* Glassmorphism: 10-20px */
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: var(--space-2xl);
  box-shadow: var(--shadow-md);
}
/* Sem hover/cursor em card estático: só card clicável recebe cursor:pointer.
   Sem translateY — a checklist proíbe hover que desloca layout. */
.card--interactive { cursor: pointer; transition: border-color 200ms ease, box-shadow 200ms ease; }
.card--interactive:hover { border-color: var(--color-secondary); box-shadow: var(--shadow-lg); }
```

### Inputs

```css
.input {
  background: var(--color-muted);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 16px;                        /* 16px = evita zoom automático no iOS */
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.input::placeholder { color: var(--color-muted-foreground); }
.input:focus-visible {
  border-color: var(--color-secondary);
  outline: 2px solid var(--color-ring);
  outline-offset: 1px;
}
.input[aria-invalid="true"] { border-color: var(--color-destructive); }
```

### Modals

```css
.modal-overlay { background: rgba(2, 6, 23, 0.72); backdrop-filter: blur(4px); }
.modal {
  background: var(--color-card);
  color: var(--color-card-foreground);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: var(--space-3xl);
  box-shadow: var(--shadow-xl);
  max-width: 520px;
  width: 90%;
}
```

### Valores monetários (componente do domínio)

```css
.money { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.money--in  { color: var(--color-accent); }       /* entrada  */
.money--out { color: var(--color-destructive); }  /* saída    */
```

> Cor sozinha nunca carrega o sinal: entrada e saída levam **sinal explícito (`+` / `−`)** e ícone,
> por causa da regra "never rely on color alone" (Charts & Data, prioridade 10).

---

## Style Guidelines

**Style:** Glassmorphism

**Keywords:** Frosted glass, transparent, blurred background, layered, vibrant background, light source, depth, multi-layer

**Best For:** Modern SaaS, financial dashboards, high-end corporate, lifestyle apps, modal overlays, navigation

**Key Effects:** Backdrop blur (10-20px), subtle border (1px solid rgba white 0.2), light reflection, Z-depth

### Page Pattern

> **OVERRIDE APLICADO.** O `--design-system` retornou *Product Demo + Features* (Hero > vídeo >
> features > CTA). Isso é estrutura de **landing page de conversão**, não de aplicação. Não há
> visitante para converter aqui: o usuário já está dentro da ferramenta. Aplicar esse pattern
> produziria uma home de marketing no lugar de um dashboard operacional.

**Pattern Name:** App Shell + Dashboard (definido manualmente)

- **Estrutura:** navegação lateral persistente (bottom nav no mobile) + área de conteúdo por rota
- **Ordem do dashboard:** Resumo do mês (stat cards) > Alertas acionáveis > Gastos por categoria
  (barra horizontal) > Evolução mensal (linha) > Lançamentos recentes
- **CTA primário:** "Novo lançamento" — fixo e alcançável de qualquer tela
- **Regra de rota:** ≤5 itens na navegação principal (guideline de Navigation Patterns, prioridade 9)

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Pure white backgrounds

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

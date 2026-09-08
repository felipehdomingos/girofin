"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  /*
   * O tema preferido mora no localStorage, que não existe no servidor. Ler no
   * inicializador do useState daria divergência de hidratação: o servidor
   * renderizaria "dark" e o cliente possivelmente "light", no mesmo HTML.
   *
   * Então a leitura acontece depois da montagem mesmo. O `set-state-in-effect`
   * existe para evitar render extra desnecessário — aqui ele é necessário e
   * acontece uma vez só, na montagem.
   */
  useEffect(() => {
    const saved = window.localStorage.getItem("girofin-theme");
    const nextTheme: Theme = saved === "light" ? "light" : "dark";
    applyTheme(nextTheme);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setTheme(nextTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem("girofin-theme", nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Mudar para o tema ${theme === "dark" ? "claro" : "escuro"}`}
      title={`Tema ${theme === "dark" ? "claro" : "escuro"}`}
      className="rounded-control p-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}

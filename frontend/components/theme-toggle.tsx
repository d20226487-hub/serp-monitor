"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Single icon: shows the OPPOSITE of the current theme so it represents
 * "click to switch to this." First visit follows system preference; once
 * the user clicks, the choice is persisted to localStorage and respected
 * forever (system theme changes are no longer auto-followed on this device).
 *
 * The pre-paint script in app/layout.tsx is the source of truth on initial
 * load — this component just reads the resulting class and toggles it.
 */
export function ThemeToggle() {
  const { t } = useT();
  // null until after hydration so we don't render a guessed icon and flicker
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setIsDark(next);
  }

  // Reserve space (~36px square) until we know the theme — avoids layout shift
  if (isDark === null) {
    return <div className="w-9 h-9" aria-hidden />;
  }

  const label = isDark ? t.themeSwitchToLight : t.themeSwitchToDark;
  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className="p-2 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

"use client";
import { useT, Lang } from "@/lib/i18n";

export function LanguageToggle() {
  const { lang, setLang, t } = useT();

  function pick(next: Lang) {
    if (next === lang) return;
    setLang(next);
  }

  const base =
    "px-2 py-1 text-xs font-medium rounded transition-colors";
  const active =
    "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100";
  const idle =
    "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100";

  return (
    <div
      role="group"
      aria-label={t.langSwitchTitle}
      title={t.langSwitchTitle}
      className="inline-flex items-center gap-1 rounded-md border dark:border-slate-700 px-1 py-0.5"
    >
      <button
        type="button"
        onClick={() => pick("en")}
        aria-pressed={lang === "en"}
        className={`${base} ${lang ==="en" ? active : idle}`}
      >
        {t.langName.en}
      </button>
      <button
        type="button"
        onClick={() => pick("ru")}
        aria-pressed={lang === "ru"}
        className={`${base} ${lang ==="ru" ? active : idle}`}
      >
        {t.langName.ru}
      </button>
    </div>
  );
}

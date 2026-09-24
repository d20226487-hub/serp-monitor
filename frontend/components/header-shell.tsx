"use client";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { useT } from "@/lib/i18n";

export function HeaderShell() {
  const { t } = useT();
  return (
    <header className="border-b dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold">
          {t.appName}
        </Link>
        <nav className="text-sm flex gap-4 text-neutral-600 dark:text-neutral-300">
          <Link href="/">{t.nav.jobs}</Link>
          <Link href="/projects">{t.nav.projects}</Link>
          <Link href="/jobs/new">{t.nav.newJob}</Link>
          <Link href="/settings">{t.nav.settings}</Link>
          <Link href="/docs">{t.nav.docs}</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

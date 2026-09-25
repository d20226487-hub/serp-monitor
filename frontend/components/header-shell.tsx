"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { Icon, type IconName } from "@/components/icons";
import { useT } from "@/lib/i18n";

/**
 * The app frame, matching Site Auditor's: the current section is a filled
 * chip rather than four identical links, and the one thing people come here to
 * do — start a job — is a button in the header, reachable from whatever run
 * they are reading rather than only from one page.
 */
const NAV: { href: string; key: "jobs" | "projects" | "settings" | "docs"; icon: IconName }[] = [
  { href: "/", key: "jobs", icon: "list" },
  { href: "/projects", key: "projects", icon: "layers" },
  { href: "/settings", key: "settings", icon: "sliders" },
  { href: "/docs", key: "docs", icon: "info" },
];

export function HeaderShell() {
  const { t } = useT();
  const pathname = usePathname() || "/";

  /** Jobs owns both the list and everything under /jobs and /runs, so reading
   *  a run does not leave the header looking like nowhere is selected. */
  function isActive(href: string): boolean {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/jobs") || pathname.startsWith("/runs");
    }
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Icon name="search" className="h-3.5 w-3.5" />
          </span>
          {t.appName}
        </Link>

        <nav className="flex flex-wrap gap-1">
          {NAV.map(item => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm transition ${
                  active
                    ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                {t.nav[item.key]}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/jobs/new"
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t.nav.newJob}
          </Link>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

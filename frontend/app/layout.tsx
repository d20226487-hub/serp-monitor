import "./globals.css";
import type { Metadata } from "next";
import { LangProvider } from "@/lib/i18n";
import { HeaderShell } from "@/components/header-shell";

export const metadata: Metadata = {
  title: "SERP Monitor",
  description: "Brand-protection SERP scraper (Google + Yandex via SerpAPI)",
};

// Inline pre-paint script: applies the .dark class and the lang attribute
// to <html> BEFORE first render so we never flash the wrong theme/locale on
// reload. Reads localStorage first (the user's manual choice), falls back
// to system preference for theme and to "en" for language.
const preInitScript = `
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved === 'dark'
      || (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
  try {
    var lang = localStorage.getItem('lang');
    if (lang !== 'en' && lang !== 'ru') lang = 'en';
    document.documentElement.lang = lang;
  } catch (e) {}
})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preInitScript }} />
      </head>
      <body>
        <LangProvider>
          <HeaderShell />
          {/* max-w-7xl to match Site Auditor: the tables here are wide and the
              old 6xl forced the analyzer view to break out of the container. */}
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </LangProvider>
      </body>
    </html>
  );
}

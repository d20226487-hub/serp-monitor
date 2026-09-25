"use client";

// The shared look, ported from Site Auditor (components/ui.tsx there) so the
// two tools read the same way: cards with icon titles, verdict pills that
// always carry an icon AND a word rather than colour alone, a 4px tone edge or
// light wash for state, and prose at 14px near-black with small grey kept for
// labels, ids and dense tables only.
//
// Tones mean the same thing in both apps: red bad, amber warning, emerald
// good, slate neutral, and sky reserved for structure — never for a verdict.

import { type ReactNode } from "react";
import { Icon, isPhoneName, type IconName } from "@/components/icons";

export function Card({
  title,
  children,
  actions,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:disabled:bg-slate-700",
  ghost:
    "border border-slate-300 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800",
  danger:
    "border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
} as const;

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  className = "",
  size = "md",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** `sm` for the row of actions on a card, so they do not outweigh its content. */
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition ${
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
      } ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:focus:border-slate-500";

const TONES = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Run status → colour, so a status reads the same in a list and on a page.
 *  Both spellings of "cancel" are accepted: Site Auditor writes "cancelled",
 *  this app writes "canceled", and the shared kit should not care. */
export function statusTone(status: string): Tone {
  if (status === "done") return "good";
  if (status === "failed") return "bad";
  if (status === "running") return "info";
  if (status === "cancelled" || status === "canceled" || status === "skipped") return "warn";
  return "neutral";  // pending, and anything a future version adds
}

/** A SERP position → colour. The three bands anyone reading a position thinks
 *  in: the top three, the rest of page one, and everything past it. */
export function positionTone(position: number | null | undefined): Tone {
  if (position == null) return "neutral";
  if (position <= 3) return "good";
  if (position <= 10) return "info";
  return "warn";
}

/** A small dot in a tone: severity on a filter chip, a Core Web Vitals band. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-slate-400",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  info: "bg-sky-500",
};

/**
 * A toggle that filters a list. Deliberately NOT a Badge.
 *
 * The findings filters used to be badges wrapped in buttons, with "selected"
 * shown as the blue `info` tone, and that failed three ways at once. An
 * unselected severity chip is already coloured, so colour could not also mean
 * "on". Blue is itself a severity colour, so a selected `low` chip looked like
 * an unselected `info` one. And badges are what static labels look like
 * everywhere else in the app, so nothing said "this is clickable" at all.
 *
 * So: a chip is a pill where badges are square; off is an outline; on is solid
 * dark with a check mark — the same filled style as the active settings tab.
 * Meaning such as severity rides on a small dot that looks identical in both
 * states, and `aria-pressed` carries the state for screen readers, which a
 * colour never did.
 */
export function FilterChip({
  selected,
  onClick,
  children,
  count,
  dot,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  dot?: Tone;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        selected
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
      }`}
    >
      {selected && <span aria-hidden="true">✓</span>}
      {dot && <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[dot]}`} />}
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={`tabular-nums ${selected ? "opacity-80" : "text-slate-500 dark:text-slate-400"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** One labelled row of FilterChips. The label is what replaces a bare "|":
 *  a separator says two groups exist, never what either one filters by. */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A row of tabs, styled like the Profiles and Settings tabs, with an optional
 *  count per tab so a reader sees how much is behind one before opening it. */
export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { key: K; label: ReactNode; count?: number | string | null }[];
  active: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 dark:border-slate-800"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
              selected
                ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  selected
                    ? "bg-white/20 dark:bg-slate-900/15"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {children}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      {children}
    </p>
  );
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export function bytes(value: number | null | undefined): string {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// --- The report look: cards, verdict pills, coloured edges ----------------------------
//
// Shared by every report tab so they read alike (the user, 2026-09-17: "I really
// do not like these wall of text … add more highlights, colors, contrast and
// separation between sections and subsections"). Rules the pieces keep:
// - a verdict is a pill that carries an icon and a word, never colour alone;
// - red is bad, amber a warning, emerald good, slate neutral; sky is structure
//   (section icons, info), never a verdict;
// - prose stays 14px slate-800 — hierarchy comes from weight, size and cards.

export const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  warn: "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
  bad: "bg-red-50 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800",
  info: "bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800",
};

/** A 4px left edge in a tone, for a card with `border border-l-4`. The dark
 *  variants repeat the colour because the card's own dark border colour would
 *  otherwise paint over it. */
export const TONE_EDGE: Record<Tone, string> = {
  neutral: "border-l-slate-300 dark:border-l-slate-600",
  good: "border-l-emerald-500 dark:border-l-emerald-500",
  warn: "border-l-amber-400 dark:border-l-amber-500",
  bad: "border-l-red-500 dark:border-l-red-500",
  info: "border-l-sky-500 dark:border-l-sky-500",
};

/** A faint wash and border in a tone, for a block that holds a verdict. */
export const TONE_WASH: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900",
  good: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  warn: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  bad: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
  info: "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
};

/** An icon's colour in a tone. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-slate-500 dark:text-slate-400",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  info: "text-sky-600 dark:text-sky-400",
};

/** A verdict as a pill. `md` is for the verdict a card is about; `sm` for tags beside it. */
export function Pill({
  tone = "neutral",
  icon,
  children,
  title,
  size = "sm",
}: {
  tone?: Tone;
  icon?: IconName | ReactNode;
  children: ReactNode;
  title?: string;
  size?: "sm" | "md";
}) {
  const iconSize = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${
        size === "md" ? "gap-1.5 px-2.5 py-1 text-[13px]" : "gap-1 px-2 py-0.5 text-xs"
      } ${TONE_PILL[tone]}`}
    >
      {typeof icon === "string" ? <Icon name={icon as IconName} className={iconSize} /> : icon}
      {children}
    </span>
  );
}

/** A card's title: an icon on a tinted square, the name, and a count. */
export function SectionTitle({ icon, count, children }: { icon: IconName; count?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-50">{children}</span>
      {count !== undefined && count !== null && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {count}
        </span>
      )}
    </span>
  );
}

const METER_FILL: Record<Tone, [string, string]> = {
  neutral: ["bg-slate-200 dark:bg-slate-800", "bg-slate-500 dark:bg-slate-400"],
  good: ["bg-emerald-100 dark:bg-emerald-950", "bg-emerald-500 dark:bg-emerald-400"],
  warn: ["bg-amber-100 dark:bg-amber-950", "bg-amber-500 dark:bg-amber-400"],
  bad: ["bg-red-100 dark:bg-red-950", "bg-red-500 dark:bg-red-400"],
  info: ["bg-sky-100 dark:bg-sky-950", "bg-sky-500 dark:bg-sky-400"],
};

/** A share as a short bar: the track is the whole, the fill the part, both in
 *  one tone. Decorative — the numbers are always written beside it. */
export function Meter({
  value,
  max,
  tone = "warn",
  className = "w-10",
}: {
  value: number;
  max: number;
  tone?: Tone;
  className?: string;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [track, fill] = METER_FILL[tone];
  return (
    <span aria-hidden="true" className={`relative inline-block h-1.5 shrink-0 overflow-hidden rounded-full ${track} ${className}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
        style={{ width: `${value > 0 ? Math.max(share * 100, 6) : 0}%` }}
      />
    </span>
  );
}

/** One headline number: a label, the value, and a line under it. */
export function StatTile({
  label,
  value,
  tone = "neutral",
  icon,
  hint,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  icon?: IconName;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-l-4 border-slate-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-900 ${TONE_EDGE[tone]}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
        {icon && <Icon name={icon} className={`h-3.5 w-3.5 ${TONE_TEXT[tone]}`} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-50">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{hint}</div>}
      {children}
    </div>
  );
}

/** A note with weight: an icon, an optional title and the text, on a wash. */
export function Callout({
  tone = "info",
  icon = "info",
  title,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${TONE_WASH[tone]}`}>
      <Icon name={icon} className={`mt-0.5 h-4 w-4 ${TONE_TEXT[tone]}`} />
      <div className="min-w-0 flex-1 space-y-1 leading-relaxed text-slate-800 dark:text-slate-200">
        {title && <div className="font-semibold text-slate-900 dark:text-slate-50">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** A device's name with a phone or monitor in front of it. `phone` says which
 *  when the name does not ("Телефон"); otherwise the name decides. */
export function DeviceChip({ name, title, phone }: { name: string; title?: string; phone?: boolean }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
    >
      <Icon name={(phone ?? isPhoneName(name)) ? "phone" : "desktop"} className="h-3 w-3 text-slate-500 dark:text-slate-400" />
      <span className="truncate">{name}</span>
    </span>
  );
}

const STATUS_ICON: Record<string, IconName> = {
  done: "check",
  failed: "cross",
  running: "clock",
  queued: "clock",
  planning: "clock",
  posted: "clock",
  planned: "list",
  cancelled: "dash",
  skipped: "dash",
  rejected: "cross",
};

/** A run or page status as a pill; the caller passes the translated word. */
export function StatusPill({ status, label, size }: { status: string; label: string; size?: "sm" | "md" }) {
  return (
    <Pill tone={statusTone(status)} icon={STATUS_ICON[status] ?? "dash"} size={size}>
      {label}
    </Pill>
  );
}

/** An on/off switch: a button whose knob, colour and `aria-checked` all say the state. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
        checked ? "bg-sky-600 dark:bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? "translate-x-[1.375rem]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

/** Where a page lives, split: the path first and dark, the host after it and light. */
export function PageAddress({ url, showHost = true }: { url: string; showHost?: boolean }) {
  let host = "";
  let path = url;
  try {
    const parsed = new URL(url);
    host = parsed.host.replace(/^www\./i, "");
    path = `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    // Not a full address: shown as it is.
  }
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5" title={url}>
      <span className="truncate font-medium text-slate-900 dark:text-slate-100">{path}</span>
      {showHost && host && <span className="hidden shrink-0 text-xs text-slate-500 sm:inline dark:text-slate-400">{host}</span>}
    </span>
  );
}

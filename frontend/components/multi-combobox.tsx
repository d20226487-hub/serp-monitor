"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { X, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/lib/i18n";

export type Option<T = string> = { value: T; label: string; sub?: string };

type Props<T> = {
  label: string;
  placeholder?: string;
  options?: Option<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  /** Async source for large lists (locations). Receives query, returns options. */
  fetchOptions?: (query: string) => Promise<Option<T>[]>;
  /** Render a chip for a value not in the static options (async case). */
  renderChip?: (value: T) => string;
  /** Match using the option's value when comparing, default identity. */
  isEqual?: (a: T, b: T) => boolean;
};

export function MultiCombobox<T = string>({
  label,
  placeholder,
  options,
  selected,
  onChange,
  fetchOptions,
  renderChip,
  isEqual = (a, b) => a === b,
}: Props<T>) {
  const { t } = useT();
  const ph = placeholder ?? t.combobox.searching;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Option<T>[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Async fetch with debounce. Fires on empty query too, so callers can show
  // a baseline list (e.g. saved locations) when the dropdown opens.
  useEffect(() => {
    if (!fetchOptions || !open) return;
    const delay = q.trim().length === 0 ? 0 : 200;
    const handle = setTimeout(async () => {
      setLoading(true);
      try { setRemote(await fetchOptions(q)); }
      catch { setRemote([]); }
      finally { setLoading(false); }
    }, delay);
    return () => clearTimeout(handle);
  }, [q, fetchOptions, open]);

  const visible: Option<T>[] = useMemo(() => {
    if (fetchOptions) return remote;
    if (!options) return [];
    if (!q) return options;
    const needle = q.toLowerCase();
    return options.filter(o =>
      o.label.toLowerCase().includes(needle) ||
      String(o.value).toLowerCase().includes(needle) ||
      (o.sub?.toLowerCase().includes(needle))
    );
  }, [options, fetchOptions, remote, q]);

  const isSelected = (v: T) => selected.some(s => isEqual(s, v));
  const toggle = (v: T) => {
    if (isSelected(v)) onChange(selected.filter(s => !isEqual(s, v)));
    else onChange([...selected, v]);
  };
  const remove = (v: T) =>
    onChange(selected.filter(s => !isEqual(s, v)));

  const labelOf = (v: T) => {
    const found = options?.find(o => isEqual(o.value, v))
      || remote.find(o => isEqual(o.value, v));
    return found?.label ?? renderChip?.(v) ?? String(v);
  };

  return (
    <div className="space-y-1.5" ref={ref}>
      <label className="text-sm font-medium">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={clsx(
            "w-full min-h-[40px] px-2.5 py-1.5 rounded-md border bg-white dark:bg-neutral-900",
            "dark:border-neutral-700 flex flex-wrap gap-1 items-center text-left"
          )}
        >
          {selected.length === 0 && (
            <span className="text-neutral-500 text-sm px-1">{ph}</span>
          )}
          {selected.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-0.5 text-xs"
            >
              {labelOf(v)}
              <X
                className="w-3 h-3 cursor-pointer opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); remove(v); }}
              />
            </span>
          ))}
          <ChevronDown className="ml-auto w-4 h-4 opacity-60" />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full">
            <Command shouldFilter={false}>
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder={ph}
              />
              <Command.List>
                {loading && <div className="px-3 py-2 text-sm text-neutral-500">{t.combobox.searching}</div>}
                {!loading && visible.length === 0 && (
                  <Command.Empty>{t.combobox.noMatches}</Command.Empty>
                )}
                {visible.map((o, i) => (
                  <Command.Item
                    key={i}
                    value={`${o.label}::${i}`}
                    onSelect={() => toggle(o.value)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div>{o.label}</div>
                        {o.sub && <div className="text-xs text-neutral-500">{o.sub}</div>}
                      </div>
                      {isSelected(o.value) && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>
                      )}
                    </div>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";

/** Where a floating list sits: under its button, or above it. */
type Place = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * A list that opens from a button, placed against the window rather than the
 * table (which scrolls sideways in a box that would cut it off): under the
 * button, or above it when there is more room there, as tall as the window
 * allows and kept on screen.
 *
 * It closes on a click outside it, on Escape, when the window is resized, and
 * when the PAGE scrolls from under it — never when the list itself scrolls
 * (user, 2026-10-30, on a long cluster list: "does not scroll when using mouse
 * scroll and closes when trying to use the built-in scroll"). A scroll inside
 * the list reaches the window's capture listener too, so it is told apart by
 * where it happened; and the list keeps its scrolling to itself
 * (overscroll-contain), so reaching its end does not scroll the page instead.
 */
export function useFloatingList(width: number, tallest = 320) {
  const [place, setPlace] = useState<Place | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!place) return;
    const close = () => setPlace(null);
    const outside = (e: Event) => !(box.current && e.target instanceof Node && box.current.contains(e.target));
    const away = (e: MouseEvent) => { if (outside(e)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const scrolled = (e: Event) => { if (outside(e)) close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [place]);
  function toggle() {
    const r = button.current?.getBoundingClientRect();
    if (place || !r) { setPlace(null); return; }
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPlace(below >= Math.min(tallest, 200) || below >= above
      ? { left, top: r.bottom + 4, maxHeight: Math.min(tallest, below) }
      : { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(tallest, above) });
  }
  const style = place ? { left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, width } : undefined;
  return { open: place !== null, box, button, toggle, close: () => setPlace(null), style };
}

export const FLOATING = "fixed z-30 rounded-lg border border-slate-200 bg-white text-sm font-normal text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

/** One choice of a list: its value, how it reads in the list, and as plain
 *  text (the button's label and the search). */
export type Choice = { value: string; label: ReactNode; text: string };

/** A list long enough to need a search. */
export const SEARCH_FROM = 9;

/** The choices whose text holds what is typed. */
export function found(choices: Choice[], find: string): Choice[] {
  const q = find.trim().toLowerCase();
  return q ? choices.filter(c => c.text.toLowerCase().includes(q)) : choices;
}

/**
 * One choice from a list that can be long, with a search — in place of the
 * browser's own select, which can only be scrolled or jumped through by first
 * letter (user, 2026-10-30, of the clusters page's: "How scalable and
 * user-friendly these will be when there are many clusters?"). Enter in the
 * search picks the first one found.
 */
export function PickOne({ choices, value, onPick, findLabel, nothing, className = "" }: {
  choices: Choice[];
  value: string;
  onPick: (value: string) => void;
  /** The search's placeholder, and what to say when it finds nothing. */
  findLabel: string;
  nothing: string;
  className?: string;
}) {
  const list = useFloatingList(260);
  const [find, setFind] = useState("");
  const shown = found(choices, find);
  const current = choices.find(c => c.value === value);
  const pick = (v: string) => { onPick(v); list.close(); };
  return (
    <span ref={list.box} className="relative inline-flex">
      <button
        ref={list.button}
        type="button"
        aria-expanded={list.open}
        aria-haspopup="listbox"
        onClick={() => { setFind(""); list.toggle(); }}
        className={`flex items-center justify-between gap-2 ${className}`}
      >
        <span className="max-w-56 truncate">{current?.label ?? value}</span>
        <Icon name="chevronDown" className="h-3 w-3 shrink-0" />
      </button>
      {list.open && (
        <div style={list.style} className={`${FLOATING} flex flex-col`}>
          {choices.length >= SEARCH_FROM && (
            <div className="shrink-0 border-b p-2 dark:border-slate-800">
              <input
                autoFocus
                value={find}
                onChange={e => setFind(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && shown.length) { e.preventDefault(); pick(shown[0].value); } }}
                placeholder={findLabel}
                className={`${inputClass} py-1 text-xs`}
              />
            </div>
          )}
          <div role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {shown.map(c => (
              <button
                key={c.value || "-"}
                type="button"
                role="option"
                aria-selected={c.value === value}
                onClick={() => pick(c.value)}
                className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  c.value === value ? "font-medium text-sky-700 dark:text-sky-400" : ""
                }`}
              >
                {c.label}
              </button>
            ))}
            {shown.length === 0 && <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">{nothing}</p>}
          </div>
        </div>
      )}
    </span>
  );
}

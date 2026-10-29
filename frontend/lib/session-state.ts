"use client";
import { useEffect, useRef, useState } from "react";

/**
 * State that survives a reload of the page (user, 2026-10-29: "When the user
 * refreshes can we save the last place they were inside the project?").
 *
 * Kept in sessionStorage under `key`: a reload of this browser tab comes back
 * to it, while a new tab or a later visit starts from the defaults — a period
 * picked last week is not where anybody expects to land today. Read after
 * mount, so the first render matches the server's; a stored value `valid`
 * rejects (an older shape, a hand-edited one) is ignored rather than trusted.
 */
export function useSessionState<T>(
  key: string, initial: T, valid: (v: unknown) => v is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const read = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) {
        const stored: unknown = JSON.parse(raw);
        if (valid(stored)) setValue(stored);
      }
    } catch {}
    read.current = true;
    // `valid` is a fixed predicate; the key is what identifies the value.
  }, [key]);
  useEffect(() => {
    // Not before the stored value was read: that would write the default
    // over it on the first render.
    if (!read.current) return;
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

/** Predicates for the values kept. */
export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const isDateInput = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function oneOf<T extends string>(choices: readonly T[]) {
  return (v: unknown): v is T => typeof v === "string" && (choices as readonly string[]).includes(v);
}
export const isText = (v: unknown): v is string => typeof v === "string";

/**
 * Where the page was scrolled to, back after a reload. The page's content
 * arrives after it is drawn, so the place is taken back as soon as the page is
 * tall enough to hold it — and given up if the reader scrolls first, or after
 * a few seconds.
 */
export function useScrollMemory(key: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let wanted: number | null = null;
    try {
      const raw = sessionStorage.getItem(key);
      wanted = raw === null ? null : Number(raw);
    } catch {}
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let stop = false;
    const giveUp = () => { stop = true; };
    window.addEventListener("wheel", giveUp, { once: true, passive: true });
    window.addEventListener("touchstart", giveUp, { once: true, passive: true });
    window.addEventListener("keydown", giveUp, { once: true });
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (stop || wanted === null || !Number.isFinite(wanted) || Date.now() - started > 6000) {
        window.clearInterval(timer);
        return;
      }
      if (document.documentElement.scrollHeight >= wanted + window.innerHeight || Date.now() - started > 3000) {
        window.scrollTo(0, wanted);
        if (Math.abs(window.scrollY - wanted) < 2) window.clearInterval(timer);
      }
    }, 100);
    let pending: number | undefined;
    const remember = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        try { sessionStorage.setItem(key, String(Math.round(window.scrollY))); } catch {}
      }, 200);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(pending);
      window.removeEventListener("scroll", remember);
      window.removeEventListener("wheel", giveUp);
      window.removeEventListener("touchstart", giveUp);
      window.removeEventListener("keydown", giveUp);
      window.history.scrollRestoration = previous;
    };
  }, [key, ready]);
}

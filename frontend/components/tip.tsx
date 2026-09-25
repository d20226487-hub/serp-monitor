"use client";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

/**
 * An explanation attached to something on screen.
 *
 * Replaces the browser's own `title=`, which has three problems for text worth
 * reading: it only appears on hover, so there is no way to reach it on a touch
 * screen; it vanishes the moment the pointer moves, so a long sentence has to
 * be read in one go; and it is drawn by the operating system, so it is tiny,
 * unstyled and unreadable at the length these explanations actually run to.
 *
 * Hover still opens it, because that is what people try first. Clicking PINS
 * it open, so the text can be read at leisure and selected; Escape or a click
 * elsewhere closes it again.
 *
 * Rendered in a portal because the tables these sit in scroll horizontally,
 * and `overflow-x: auto` makes the vertical axis clip too — an absolutely
 * positioned box inside one would be cut off at the row's edge.
 */
export function Tip({
  text,
  children,
  className = "",
  label,
}: {
  /** The explanation. Long is fine — this is the whole point of the box. */
  text: ReactNode;
  /** What opens it. Omitted, an ⓘ button is drawn instead. */
  children?: ReactNode;
  className?: string;
  /** Screen-reader name for the trigger when the children are not words. */
  label?: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const open = pinned || hovered;

  // Placed against the viewport, and re-placed while anything scrolls: the
  // box is outside the table in the DOM, so nothing moves it along with the
  // row it belongs to.
  useEffect(() => {
    if (!open) { setSpot(null); return; }
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (r) setSpot({ top: r.bottom + 6, left: r.left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Second pass, once the box has a size: keep it on screen. Measured rather
  // than guessed because the text is free-form and its height is not knowable
  // before it renders.
  useLayoutEffect(() => {
    const el = bubble.current;
    const r = trigger.current?.getBoundingClientRect();
    if (!el || !spot || !r) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(spot.left, window.innerWidth - width - 8));
    // Flip above when there is no room below, rather than running off the
    // bottom of a long table.
    const top =
      spot.top + height > window.innerHeight - 8 && r.top > height + 12
        ? r.top - height - 6
        : spot.top;
    if (Math.abs(left - spot.left) > 0.5 || Math.abs(top - spot.top) > 0.5) {
      setSpot({ top, left });
    }
  }, [spot, text]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // A click inside the box is someone selecting the text, not dismissing it.
      if (!trigger.current?.contains(t) && !bubble.current?.contains(t)) {
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [pinned]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={e => { e.stopPropagation(); setPinned(p => !p); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className={
          children
            // A button centres its text by default, which would knock a
            // wrapped trigger out of alignment with the column it sits in.
            ? `cursor-help [text-align:inherit] ${className}`
            : `cursor-help text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200 ${className}`
        }
      >
        {children ?? <Icon name="info" className="h-4 w-4" />}
      </button>
      {spot &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            style={{ top: spot.top, left: spot.left }}
            // whitespace-pre-line so a blank line in the text becomes a
            // paragraph break: an explanation worth three sentences is worth
            // not being one unbroken block.
            className="pointer-events-auto fixed z-50 w-[22rem] max-w-[calc(100vw-16px)] whitespace-pre-line rounded-xl border border-slate-200 bg-white p-3.5 text-[13px] leading-relaxed text-slate-700 shadow-xl ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/10"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

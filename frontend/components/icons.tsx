/**
 * The app's icons: simple strokes on a 24-unit grid, in the text colour, drawn
 * here rather than taken from a library. Every icon is decorative
 * (`aria-hidden`): the word beside it carries the meaning, so a verdict never
 * rests on a shape or a colour alone.
 */
import type { ReactNode } from "react";

export type IconName =
  | "summary" | "compare" | "actions" | "value" | "keywords" | "info" | "alert"
  | "down" | "up" | "equal" | "unknown" | "check" | "cross" | "half" | "dash" | "quote"
  | "globe" | "pages" | "activity" | "shield" | "search" | "play" | "refresh"
  | "desktop" | "phone" | "flag" | "layers" | "pointer" | "link" | "image" | "code" | "text"
  | "external" | "chevronRight" | "chevronDown" | "clock" | "robot" | "coin" | "list"
  | "plus" | "pencil" | "trash" | "copy" | "key" | "user" | "sliders" | "traffic";

const PATHS: Record<IconName, ReactNode> = {
  summary: <path d="M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  compare: (
    <>
      <rect x="3.5" y="4" width="7" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="16" rx="1.5" />
    </>
  ),
  actions: (
    <>
      <path d="M10.5 6.5h10M10.5 12h10M10.5 17.5h10" />
      <path d="M3.5 6.5l1.5 1.5 2.5-3M3.5 12l1.5 1.5 2.5-3M3.5 17.5l1.5 1.5 2.5-3" />
    </>
  ),
  value: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  keywords: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3L2.9 17.5a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17v.1" />
    </>
  ),
  down: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  up: <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  equal: <path d="M5.5 9.5h13M5.5 14.5h13" />,
  unknown: (
    <>
      <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 4.3" />
      <path d="M12 18.2v.1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  half: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" />
    </>
  ),
  dash: <path d="M6 12h12" />,
  quote: (
    <>
      <path d="M5.5 7.5H10V12H5.5zM14 7.5h4.5V12H14z" fill="currentColor" />
      <path d="M10 12c0 2.7-1.2 4.4-3.8 5.2M18.5 12c0 2.7-1.2 4.4-3.8 5.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z" />
    </>
  ),
  pages: (
    <>
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" />
    </>
  ),
  activity: <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />,
  shield: <path d="M12 3.5l7 2.8v5.2c0 4.3-2.9 7.7-7 9-4.1-1.3-7-4.7-7-9V6.3z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  desktop: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </>
  ),
  flag: <path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" />,
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  pointer: <path d="M6 3.5l12 7-5.2 1.3 3.2 6.2-2.3 1.2-3.2-6.2L6.5 17z" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.5" />
      <path d="M20.5 15.5l-5-5-9 9" />
    </>
  ),
  code: <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />,
  text: <path d="M5 6.5h14M5 11h14M5 15.5h9" />,
  external: <path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v5.5H4.5V7H10" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  robot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 4.5V8M9.5 12.5v1M14.5 12.5v1M9.5 16h5" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.9-1.4-1.3-2.5-1.3-1.5 0-2.5.8-2.5 2 0 2.6 5 1.4 5 4.1 0 1.2-1.1 2-2.5 2-1.2 0-2.2-.5-2.7-1.4M12 6.5v1.4M12 16v1.5" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5v.1M4.5 12v.1M4.5 17.5v.1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <>
      <path d="M4.5 19.5h4L19 9l-4-4L4.5 15.5z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="3.5" />
      <path d="M10.5 13L19.5 4M16.5 7l2.5 2.5M14 9.5l2 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="10" cy="17" r="2.5" />
    </>
  ),
  // Bytes moving both ways: what a load costs through a proxy.
  traffic: (
    <>
      <path d="M4 9h13M13.5 5.5L17 9l-3.5 3.5" />
      <path d="M20 15H7M10.5 11.5L7 15l3.5 3.5" />
    </>
  ),
};

export function Icon({ name, className = "h-3.5 w-3.5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Priority as signal bars: three for high, two for medium, one for low. */
export function PriorityBars({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={0.8 + i * 3.9}
          y={8 - i * 3}
          width={2.6}
          height={3.2 + i * 3}
          rx={0.9}
          fill="currentColor"
          opacity={i < level ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

/** A phone or a monitor for a device's name — decoration beside the name. */
export function isPhoneName(name: string | null | undefined): boolean {
  return /smartphone|phone|mobile|android|iphone|pixel|galaxy|ipad|tablet/i.test(name ?? "");
}

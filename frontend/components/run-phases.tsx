"use client";
import { JobRun, RunAnalysis, RunPhase } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Where a run is, phase by phase.
 *
 * A run's status alone says "running" for all four phases, and the analyzer
 * table fills in so unevenly that a healthy run and a stalled one look the
 * same: nothing visible for minutes while Ahrefs and the domain-age lookups
 * work, then verdicts one keyword at a time. Run 74 was read as stopped after
 * Ahrefs while it was in fact half way through its domain ages.
 *
 * Also shown on a FAILED run, with the phase it died in marked — that is the
 * question a failed run raises first, and its error string does not always
 * answer it.
 */
export function RunPhases({
  run, analysis,
}: { run: JobRun; analysis: RunAnalysis | null }) {
  const { t } = useT();
  const live = run.status === "running" || run.status === "pending";
  const failed = run.status === "failed";
  // A finished run has nothing left to report here, and a run that failed
  // before entering any phase (a job over the query cap, say) has nothing to
  // place on the track — its error says it all.
  if (!live && !(failed && run.phase)) return null;

  const analyzer = analysis?.mode === "analyzer";
  const phases: RunPhase[] = analyzer
    ? ["scrape", "ahrefs", ...(analysis?.whois_enabled ? ["whois" as const] : []), "ai"]
    : ["scrape"];
  // A run that has not yet written its phase (pending, or started before this
  // was tracked) is at the start of the track.
  const current = run.phase && phases.includes(run.phase) ? run.phase : "scrape";
  const at = phases.indexOf(current);

  // Verdicts are the one phase besides the scrape with a count worth showing:
  // they land a keyword at a time, and the count moving is what tells a slow
  // run from a stuck one.
  const rows = analysis?.rows ?? [];
  const judged = rows.filter(r => r.difficulty || r.ai_error).length;

  function detail(p: RunPhase): string | null {
    if (p === "scrape") {
      const failedQ = run.queries_failed
        ? ` · ${t.run.phaseFailed(run.queries_failed)}`
        : "";
      return `${run.queries_done}/${run.queries_total}${failedQ}`;
    }
    if (p === "ai" && rows.length && phases.indexOf(p) <= at) {
      return `${judged}/${rows.length}`;
    }
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      title={live ? t.run.phaseHint : undefined}
    >
      {phases.map((p, i) => {
        const state = i < at ? "done" : i === at ? (failed ? "stopped" : "active") : "todo";
        const d = detail(p);
        return (
          <span key={p} className="inline-flex items-center gap-2">
            {i > 0 && (
              <span
                className={`w-4 h-px ${state === "todo"
                  ? "bg-neutral-300 dark:bg-neutral-700"
                  : "bg-neutral-400 dark:bg-neutral-500"
                }`}
              />
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
                state === "done"
                  ? "border-emerald-200 text-emerald-800 bg-emerald-50 dark:border-emerald-900 dark:text-emerald-200 dark:bg-emerald-950/40"
                  : state === "active"
                    ? "border-amber-300 text-amber-900 bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:bg-amber-950/40"
                    : state === "stopped"
                      ? "border-red-300 text-red-800 bg-red-50 dark:border-red-900 dark:text-red-200 dark:bg-red-950/40"
                      : "border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
              }`}
            >
              {state === "done" ? (
                <span aria-hidden>✓</span>
              ) : state === "active" ? (
                // Pulsing only while something is genuinely in progress.
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
              ) : state === "stopped" ? (
                <span aria-hidden>✕</span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full border border-current" aria-hidden />
              )}
              {t.run.phases[p]}
              {d && <span className="tabular-nums opacity-80">{d}</span>}
            </span>
          </span>
        );
      })}
      {failed && (
        <span className="text-red-700 dark:text-red-300 ml-1">
          {t.run.stoppedDuring(t.run.phases[current])}
        </span>
      )}
    </div>
  );
}

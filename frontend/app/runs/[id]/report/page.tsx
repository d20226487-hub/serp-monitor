"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Job, JobRun, RunAnalysis, api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { DEPTHS, Depth } from "@/lib/serp-strength";
import { RunReport } from "@/components/run-report";

/**
 * Printable report for one analyzer run.
 *
 * Its own route rather than a mode on the run page: printing needs a page whose
 * whole body is the document, and the run page carries a header, an export bar
 * and the verify panel that would all have to be suppressed.
 */
export default function ReportPage() {
  const params = useParams();
  const id = Number(params.id);
  const { t } = useT();

  const [analysis, setAnalysis] = useState<RunAnalysis | null>(null);
  const [run, setRun] = useState<JobRun | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [depth, setDepth] = useState<Depth>(5);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Same depth the analyzer table was last read at, so the report agrees
    // with the screen the reader came from.
    try {
      const saved = localStorage.getItem("analysisDepth");
      if (saved !== null) {
        const n = Number(saved);
        if ((DEPTHS as readonly number[]).includes(n)) setDepth(n as Depth);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    (async () => {
      try {
        const [a, r] = await Promise.all([api.getAnalysis(id), api.getRun(id)]);
        setAnalysis(a);
        setRun(r);
        try {
          setJob(await api.getJob(r.job_id));
        } catch {
          // A deleted job should not cost the whole report; the run still has
          // everything the document needs except its title.
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      }
    })();
  }, [id]);

  if (error) {
    return <div className="text-sm text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!analysis || !run) {
    return <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.common.loading}</div>;
  }
  if (analysis.mode !== "analyzer") {
    return (
      <div className="space-y-3">
        <Link href={`/runs/${id}`} className="text-sm text-blue-700 dark:text-blue-300 hover:underline">
          ← {t.run.title(id)}
        </Link>
        <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.analysis.empty}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/runs/${id}`}
        className="print:hidden text-sm text-blue-700 dark:text-blue-300 hover:underline inline-block"
      >
        ← {t.run.title(id)}
      </Link>
      <RunReport
        analysis={analysis}
        run={run}
        jobName={job?.name ?? ""}
        depth={depth}
      />
    </div>
  );
}

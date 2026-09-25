"use client";
import { Suspense } from "react";
import { JobForm } from "@/components/job-form";
import { useT } from "@/lib/i18n";

export default function NewJobPage() {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.jobs.newTitle}</h1>
      {/* JobForm reads ?project= to preselect the folder, and useSearchParams
          opts a route out of prerendering unless a boundary catches it. */}
      <Suspense fallback={<div className="text-sm text-slate-600 dark:text-slate-400">{t.common.loading}</div>}>
        <JobForm />
      </Suspense>
    </div>
  );
}

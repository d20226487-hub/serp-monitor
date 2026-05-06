"use client";
import { JobForm } from "@/components/job-form";
import { useT } from "@/lib/i18n";

export default function NewJobPage() {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.jobs.newTitle}</h1>
      <JobForm />
    </div>
  );
}

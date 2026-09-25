"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  AhrefsSettings,
  AIAnalysisSettings,
  AIProviderConfigInput,
  AIProviderStatus,
  AITestResult,
  ProviderCredsInput,
  ProviderRates,
  ProviderStatus,
  SavedLocation,
  SavedLocationInput,
} from "@/lib/api";
import { googleUule } from "@/lib/uule";
import { Trash2, Pencil, Check, X, Copy } from "lucide-react";
import { useT } from "@/lib/i18n";
import { GlobalFormulaSection } from "@/components/opportunity-formula";
import { OpportunityFormula } from "@/lib/opportunity";

export default function SettingsPage() {
  const { t } = useT();
  const [items, setItems] = useState<SavedLocation[]>([]);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // single-add form
  const [add, setAdd] = useState<SavedLocationInput>({
    canonical_name: "", name: "", country_code: "", target_type: "City", yandex_lr: null,
  });
  const [busy, setBusy] = useState(false);

  // bulk import textarea
  const [bulk, setBulk] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [formula, setFormula] = useState<OpportunityFormula | null>(null);
  const [formulaDefaults, setFormulaDefaults] = useState<OpportunityFormula | null>(null);

  // edit row
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<SavedLocationInput>({ canonical_name: "" });

  async function load() {
    setItems(await api.listSavedLocations());
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    // The server owns both the formula and its defaults, so the UI never has a
    // second copy of these numbers to fall out of step.
    api.getOpportunityFormula()
      .then(r => { setFormula(r.formula); setFormulaDefaults(r.defaults); })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter(i =>
      i.canonical_name.toLowerCase().includes(q) ||
      (i.name ?? "").toLowerCase().includes(q) ||
      (i.country_code ?? "").toLowerCase().includes(q)
    );
  }, [items, filter]);

  async function addOne() {
    setErr(null);
    if (!add.canonical_name.trim()) { setErr("canonical_name required"); return; }
    setBusy(true);
    try {
      await api.createSavedLocation({
        canonical_name: add.canonical_name.trim(),
        name: add.name?.trim() || null,
        country_code: add.country_code?.trim().toLowerCase() || null,
        target_type: add.target_type?.trim() || null,
        yandex_lr: add.yandex_lr ?? null,
      });
      setAdd({ canonical_name: "", name: "", country_code: "", target_type: "City", yandex_lr: null });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally { setBusy(false); }
  }

  async function importBulk() {
    setBulkResult(null); setErr(null);
    const lines = bulk.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    // canonical_name | name | country_code | target_type | yandex_lr
    const items = lines.map<SavedLocationInput>(line => {
      const parts = line.split(/\t|\s*\|\s*/);
      const [cn, name, cc, tt, lr] = parts;
      return {
        canonical_name: (cn || "").trim(),
        name: name?.trim() || null,
        country_code: cc?.trim().toLowerCase() || null,
        target_type: tt?.trim() || null,
        yandex_lr: lr && /^\d+$/.test(lr.trim()) ? parseInt(lr.trim(), 10) : null,
      };
    }).filter(x => x.canonical_name);
    setBusy(true);
    try {
      const res = await api.importSavedLocations(items);
      setBulkResult(t.settings.bulk.result(res.added, res.skipped));
      setBulk("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Bulk import failed");
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (editId == null) return;
    await api.updateSavedLocation(editId, {
      canonical_name: editDraft.canonical_name.trim(),
      name: editDraft.name?.trim() || null,
      country_code: editDraft.country_code?.trim().toLowerCase() || null,
      target_type: editDraft.target_type?.trim() || null,
      yandex_lr: editDraft.yandex_lr ?? null,
    });
    setEditId(null);
    await load();
  }

  async function del(id: number) {
    if (!confirm(t.settings.list.deleteConfirm)) return;
    await api.deleteSavedLocation(id);
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t.settings.title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {t.settings.intro}
        </p>
      </div>

      {err && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 rounded-md px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* Providers */}
      <ProvidersSection onError={setErr} />

      {/* Ahrefs (analyzer mode) */}
      <AhrefsSection onError={setErr} />

      {/* AI providers */}
      <AIProvidersSection onError={setErr} />

      {/* AI SERP-difficulty prompt */}
      <AIAnalysisSection onError={setErr} />

      {/* Cost rates */}
      <RatesSection onError={setErr} />

      {/* Add one */}
      <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
        <h2 className="font-medium">{t.settings.addLocation.title}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t.settings.addLocation.help}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input
            value={add.canonical_name}
            onChange={e => setAdd({ ...add, canonical_name: e.target.value })}
            placeholder={t.settings.addLocation.phCanonical}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700"
          />
          <input
            value={add.name ?? ""}
            onChange={e => setAdd({ ...add, name: e.target.value })}
            placeholder={t.settings.addLocation.phName}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700"
          />
          <input
            value={add.country_code ?? ""}
            onChange={e => setAdd({ ...add, country_code: e.target.value })}
            placeholder={t.settings.addLocation.phCc}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700"
          />
          <select
            value={add.target_type ?? ""}
            onChange={e => setAdd({ ...add, target_type: e.target.value })}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700"
          >
            <option value="">{t.settings.addLocation.phType}</option>
            <option value="Country">{t.settings.addLocation.typeOptions.Country}</option>
            <option value="Region">{t.settings.addLocation.typeOptions.Region}</option>
            <option value="City">{t.settings.addLocation.typeOptions.City}</option>
            <option value="Other">{t.settings.addLocation.typeOptions.Other}</option>
          </select>
          <input
            type="number"
            value={add.yandex_lr ?? ""}
            onChange={e => setAdd({ ...add, yandex_lr: e.target.value ? Number(e.target.value) : null })}
            placeholder={t.settings.addLocation.phYandexLr}
            className="px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700"
          />
        </div>
        <button
          disabled={busy}
          onClick={addOne}
          className="px-4 py-2 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
        >{t.common.add}</button>
      </section>

      {/* Opportunity formula — the global defaults every run inherits. */}
      <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
        <h2 className="font-medium">{t.formula.title}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t.formula.subtitle}</p>
        {formula && formulaDefaults ? (
          <GlobalFormulaSection
            initial={formula}
            defaults={formulaDefaults}
            onSave={async f => {
              const r = await api.saveOpportunityFormula(f);
              setFormula(r.formula);
            }}
            onReset={async () => {
              const r = await api.resetOpportunityFormula();
              setFormula(r.formula);
            }}
          />
        ) : (
          <div className="text-xs text-slate-600 dark:text-slate-400">{t.common.loading}</div>
        )}
      </section>

      {/* Bulk import */}
      <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
        <h2 className="font-medium">{t.settings.bulk.title}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t.settings.bulk.help}
        </p>
        <textarea
          value={bulk}
          onChange={e => setBulk(e.target.value)}
          rows={8}
          placeholder={"Almaty,Almaty Province,Kazakhstan | Almaty | kz | City | 162\nTashkent,Tashkent Region,Uzbekistan | Tashkent | uz | City | 11353"}
          className="w-full px-3 py-2 rounded-md border font-mono text-sm bg-white dark:bg-slate-900 dark:border-slate-700"
        />
        <div className="flex items-center gap-3">
          <button disabled={busy} onClick={importBulk}
            className="px-4 py-2 rounded-md border dark:border-slate-700 disabled:opacity-50">{t.common.import}</button>
          {bulkResult && <span className="text-sm text-emerald-700 dark:text-emerald-300">{bulkResult}</span>}
        </div>
      </section>

      {/* Saved list */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">{t.settings.list.heading(items.length)}</h2>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder={t.common.filter}
            className="ml-auto px-3 py-1.5 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm" />
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t.settings.list.perProviderHelp}
        </p>

        <div className="border rounded-md overflow-hidden dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
              <tr>
                <th className="px-3 py-2">{t.settings.list.cols.canonical}</th>
                <th className="px-3 py-2">{t.settings.list.cols.name}</th>
                <th className="px-3 py-2">{t.settings.list.cols.cc}</th>
                <th className="px-3 py-2">{t.settings.list.cols.type}</th>
                <th className="px-3 py-2">{t.settings.list.cols.yandexLr}</th>
                <th className="px-3 py-2">{t.settings.list.cols.uule}</th>
                <th className="px-3 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.id} className="border-t dark:border-slate-800 align-top">
                  {editId === it.id ? (
                    <>
                      <td className="px-3 py-2"><input value={editDraft.canonical_name}
                        onChange={e => setEditDraft({ ...editDraft, canonical_name: e.target.value })}
                        className="w-full px-2 py-1 rounded border bg-white dark:bg-slate-900 dark:border-slate-700" /></td>
                      <td className="px-3 py-2"><input value={editDraft.name ?? ""}
                        onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                        className="w-full px-2 py-1 rounded border bg-white dark:bg-slate-900 dark:border-slate-700" /></td>
                      <td className="px-3 py-2"><input value={editDraft.country_code ?? ""}
                        onChange={e => setEditDraft({ ...editDraft, country_code: e.target.value })}
                        className="w-16 px-2 py-1 rounded border bg-white dark:bg-slate-900 dark:border-slate-700" /></td>
                      <td className="px-3 py-2"><input value={editDraft.target_type ?? ""}
                        onChange={e => setEditDraft({ ...editDraft, target_type: e.target.value })}
                        className="w-24 px-2 py-1 rounded border bg-white dark:bg-slate-900 dark:border-slate-700" /></td>
                      <td className="px-3 py-2"><input type="number" value={editDraft.yandex_lr ?? ""}
                        onChange={e => setEditDraft({ ...editDraft, yandex_lr: e.target.value ? Number(e.target.value) : null })}
                        className="w-24 px-2 py-1 rounded border bg-white dark:bg-slate-900 dark:border-slate-700" /></td>
                      <td className="px-3 py-2"><UuleCell canonicalName={editDraft.canonical_name} /></td>
                      <td className="px-3 py-2 flex gap-2">
                        <button onClick={saveEdit} className="text-emerald-700 dark:text-emerald-300"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditId(null)} className="text-slate-600 dark:text-slate-400"><X className="w-4 h-4" /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-mono text-xs break-all">{it.canonical_name}</td>
                      <td className="px-3 py-2">{it.name ?? "—"}</td>
                      <td className="px-3 py-2 uppercase">{it.country_code ?? "—"}</td>
                      <td className="px-3 py-2">{it.target_type ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{it.yandex_lr ?? "—"}</td>
                      <td className="px-3 py-2"><UuleCell canonicalName={it.canonical_name} /></td>
                      <td className="px-3 py-2 flex gap-2">
                        <button onClick={() => { setEditId(it.id); setEditDraft(it); }} className="text-slate-600 dark:text-slate-300">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => del(it.id)} className="text-red-600 dark:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-600 dark:text-slate-400">{t.settings.list.empty}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


/* ------------- Inline UULE preview cell ------------- */

function UuleCell({ canonicalName }: { canonicalName: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const value = useMemo(() => googleUule(canonicalName), [canonicalName]);
  if (!value) {
    return <span className="text-slate-600 dark:text-slate-400">—</span>;
  }
  const truncated = value.length > 18 ? value.slice(0, 18) + "…" : value;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {/* clipboard blocked */}
  }
  return (
    <div className="flex items-center gap-1.5">
      <code title={value} className="font-mono text-xs cursor-help text-slate-700 dark:text-slate-300">
        {truncated}
      </code>
      <button
        onClick={copy}
        className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        title={t.settings.list.copyUuleTitle}
      >
        {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}


/* ------------- AI SERP-difficulty prompt ------------- */

function AIAnalysisSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [data, setData] = useState<AIAnalysisSettings | null>(null);
  const [tuning, setTuning] = useState({
    temperature: "0.2", thinking_budget: "0", max_output_tokens: "600",
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    try {
      const d = await api.getAIAnalysisSettings();
      setTuning({
        temperature: String(d.temperature),
        thinking_budget: String(d.thinking_budget),
        max_output_tokens: String(d.max_output_tokens),
      });
      setData(d);
      setDraft(null);
      setDomainDraft(null);
    } catch (e: any) { onError(e?.message ?? "Failed to load AI analysis settings"); }
  }
  useEffect(() => { reload(); }, []);

  async function save() {
    if (draft == null) return;
    setMsg(null); onError(null);
    try { await api.setAIPrompt(draft); setMsg(t.common.saved); await reload(); }
    catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  async function saveDomain() {
    if (domainDraft == null) return;
    setMsg(null); onError(null);
    try { await api.setAIDomainPrompt(domainDraft); setMsg(t.common.saved); await reload(); }
    catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  async function resetDomain() {
    if (!confirm(t.settings.aiAnalysis.resetConfirm)) return;
    setMsg(null);
    try { await api.setAIDomainPrompt(null); setMsg(t.settings.aiAnalysis.resetDone); await reload(); }
    catch (e: any) { onError(e?.message ?? "Reset failed"); }
  }

  async function reset() {
    // Explicit user action only — never wipe a tuned prompt on our own.
    if (!confirm(t.settings.aiAnalysis.resetConfirm)) return;
    setMsg(null);
    try { await api.setAIPrompt(null); setMsg(t.settings.aiAnalysis.resetDone); await reload(); }
    catch (e: any) { onError(e?.message ?? "Reset failed"); }
  }

  async function saveTuning() {
    onError(null);
    try {
      const r = await api.setAITuning({
        temperature: tuning.temperature === "" ? null : Number(tuning.temperature),
        thinking_budget: tuning.thinking_budget === "" ? null : Number(tuning.thinking_budget),
        max_output_tokens:
          tuning.max_output_tokens === "" ? null : Number(tuning.max_output_tokens),
      });
      // Echo back what the server clamped to, so an out-of-range entry does
      // not sit on screen looking accepted.
      setTuning({
        temperature: String(r.temperature),
        thinking_budget: String(r.thinking_budget),
        max_output_tokens: String(r.max_output_tokens),
      });
      setMsg(t.common.saved);
      await reload();
    } catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  async function pickProvider(v: string) {
    onError(null);
    try { await api.setAIAnalysisProvider(v === "auto" ? null : v); await reload(); }
    catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  if (!data) return null;
  const value = draft ?? data.prompt;

  return (
    <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t.settings.aiAnalysis.title}</h2>
        {data.is_custom ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200">
            {t.settings.aiAnalysis.customised}
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {t.settings.aiAnalysis.usingDefault}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.aiAnalysis.help}</p>

      {/* Sampling and reasoning. Each field carries what the measurement
          actually showed, because two of the three look equally important and
          only one of them moves the verdict. */}
      <div className="pt-2 border-t dark:border-slate-800 space-y-2.5">
        <div>
          <div className="text-sm font-medium">{t.aiTuning.tuningTitle}</div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{t.aiTuning.tuningHelp}</p>
        </div>
        {([
          ["temperature", t.aiTuning.temperature, t.aiTuning.temperatureHelp, 0, data.temperature_max, 0.1],
          ["thinking_budget", t.aiTuning.thinking, t.aiTuning.thinkingHelp, 0, data.thinking_budget_max, 128],
          ["max_output_tokens", t.aiTuning.maxTokens, t.aiTuning.maxTokensHelp, 128, 16384, 100],
        ] as const).map(([key, label, help, min, max, step]) => (
          <label key={key} className="block">
            <span className="text-xs font-medium">{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={tuning[key]}
              onChange={e => setTuning(v => ({ ...v, [key]: e.target.value }))}
              onBlur={saveTuning}
              className="ml-2 w-28 px-2 py-1 rounded border text-sm bg-white dark:bg-slate-900 dark:border-slate-700"
            />
            <span className="block text-xs text-slate-600 dark:text-slate-400 mt-0.5">{help}</span>
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">{t.settings.aiAnalysis.providerLabel}</label>
        <select
          value={data.provider ?? "auto"}
          onChange={e => pickProvider(e.target.value)}
          className="w-full sm:w-72 px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm"
        >
          <option value="auto">{t.settings.aiAnalysis.providerAuto}</option>
          {data.available.map(p => (
            <option key={p} value={p}>
              {p === "ai_studio" ? "Google AI Studio" : "Google Vertex AI"}
            </option>
          ))}
          <option value="off">{t.settings.aiAnalysis.providerOff}</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">{t.settings.aiAnalysis.promptLabel}</label>
        <div className="text-xs text-slate-600 dark:text-slate-400">{t.settings.aiAnalysis.placeholders}</div>
        <textarea
          rows={16}
          value={value}
          onChange={e => setDraft(e.target.value)}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs font-mono"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={draft == null || draft === data.prompt}
          onClick={save}
          className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm disabled:opacity-50"
        >{t.common.save}</button>
        <button onClick={reset} disabled={!data.is_custom}
          className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm disabled:opacity-50">
          {t.settings.aiAnalysis.reset}
        </button>
        {/* Loads the RU text into the editor as an UNSAVED draft — the user
            reviews and presses Save. Never writes over a saved prompt by itself. */}
        <button onClick={() => setDraft(data.default_ru)}
          className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm">
          {t.settings.aiAnalysis.loadRu}
        </button>
        {draft != null && draft !== data.prompt && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {t.settings.aiAnalysis.unsaved}
          </span>
        )}
        {msg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{msg}</span>}
      </div>

      {/* Domain-level guidance: its own prompt, because it only applies when a
          job has domain metrics on, and the authority-vs-PBN judgement it
          encodes is the part most worth tuning independently. */}
      <div className="pt-4 border-t dark:border-slate-800 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium">{t.settings.aiAnalysis.domainTitle}</label>
          {data.domain_is_custom && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200">
              {t.settings.aiAnalysis.customised}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400">{t.settings.aiAnalysis.domainHelp}</div>
        <textarea
          rows={14}
          value={domainDraft ?? data.domain_prompt}
          onChange={e => setDomainDraft(e.target.value)}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs font-mono"
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            disabled={domainDraft == null || domainDraft === data.domain_prompt}
            onClick={saveDomain}
            className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm disabled:opacity-50"
          >{t.common.save}</button>
          <button onClick={resetDomain} disabled={!data.domain_is_custom}
            className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm disabled:opacity-50">
            {t.settings.aiAnalysis.domainReset}
          </button>
          <button onClick={() => setDomainDraft(data.domain_default_ru)}
            className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm">
            {t.settings.aiAnalysis.domainLoadRu}
          </button>
          {domainDraft != null && domainDraft !== data.domain_prompt && (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              {t.settings.aiAnalysis.unsaved}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}


/* ------------- Ahrefs section (analyzer mode) ------------- */

function AhrefsSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [data, setData] = useState<AhrefsSettings | null>(null);
  const [ttlDraft, setTtlDraft] = useState("7");
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [testRes, setTestRes] = useState<{ units_billed?: number; sample_dr?: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setData(await api.getAhrefs()); }
    catch (e: any) { onError(e?.message ?? "Failed to load Ahrefs settings"); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (data) setTtlDraft(String(data.cache_ttl_days));
  }, [data]);

  async function saveTtl() {
    const n = Number(ttlDraft);
    if (!Number.isFinite(n) || n < 0) { setTtlDraft(String(data?.cache_ttl_days ?? 7)); return; }
    const r = await api.setAhrefsCacheTtl(Math.round(n));
    setTtlDraft(String(r.cache_ttl_days));
    setMsg(t.common.saved);
    await reload();
  }

  async function clearCache() {
    const r = await api.clearAhrefsCache();
    setMsg(t.jobForm.ahrefsCacheCleared(r.cleared));
  }

  async function save() {
    if (!draft.trim()) { onError("Nothing to save."); return; }
    setMsg(null); onError(null); setTestRes(null);
    try {
      await api.setAhrefsKey(draft.trim());
      setDraft("");
      setMsg(t.common.saved);
      await reload();
    } catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  async function clear() {
    if (!confirm(t.settings.ahrefs.clearConfirm)) return;
    setTestRes(null);
    await api.clearAhrefsKey();
    setMsg(t.common.cleared);
    await reload();
  }

  async function test() {
    setMsg(null); onError(null); setBusy(true);
    try { setTestRes(await api.testAhrefs()); }
    catch (e: any) { onError(e?.message ?? "Test failed"); }
    finally { setBusy(false); }
  }

  if (!data) return null;

  return (
    <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t.settings.ahrefs.title}</h2>
        {data.configured ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">{t.settings.providers.configured}</span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{t.settings.providers.notSet}</span>
        )}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.ahrefs.help}</p>

      {/* Cross-run metric cache. Its TTL is a freshness trade-off rather than a
          free win, so it is exposed rather than assumed. */}
      <div className="pt-2 border-t dark:border-slate-800 space-y-1.5">
        <div className="text-sm font-medium">{t.jobForm.ahrefsCacheTitle}</div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t.jobForm.ahrefsCacheHelp}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs">{t.jobForm.ahrefsCacheTtl}</label>
          <input
            type="number"
            min={0}
            max={data.cache_ttl_max}
            value={ttlDraft}
            onChange={e => setTtlDraft(e.target.value)}
            onBlur={saveTtl}
            className="w-20 px-2 py-1 rounded border text-sm bg-white dark:bg-slate-900 dark:border-slate-700"
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {t.jobForm.ahrefsCacheDays}
          </span>
          <button
            onClick={clearCache}
            className="ml-auto text-xs px-2.5 py-1 rounded border dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.jobForm.ahrefsCacheClear}
          </button>
        </div>
        {Number(ttlDraft) === 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-300">
            {t.jobForm.ahrefsCacheOff}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t.settings.ahrefs.apiKey}</label>
        {data.configured && (
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {t.settings.providers.savedSecret(data.last4, data.length)}
          </div>
        )}
        <input
          type="password"
          autoComplete="off"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={t.settings.ahrefs.apiKeyPlaceholder}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={save}
          className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm">{t.common.save}</button>
        <button disabled={busy} onClick={test}
          className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm disabled:opacity-50">
          {busy ? t.settings.ai.testing : t.common.test}
        </button>
        <button onClick={clear}
          className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm text-red-600 dark:text-red-400">{t.common.clear}</button>
      </div>
      {msg && <div className="text-xs text-emerald-700 dark:text-emerald-300">{msg}</div>}
      {testRes && (
        <div className="text-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded px-3 py-2">
          {t.settings.ahrefs.testOk(testRes.units_billed ?? 0)}
        </div>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.ahrefs.footnote}</p>
    </section>
  );
}


/* ------------- AI providers section ------------- */

type AIFieldSpec = {
  key: keyof AIProviderConfigInput;
  label: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
};

function useAIProviderMeta(): { id: string; name: string; help: string; fields: AIFieldSpec[] }[] {
  const { t } = useT();
  const m = t.settings.ai.meta;
  return [
    {
      id: "ai_studio",
      name: "Google AI Studio",
      help: m.ai_studio.help,
      fields: [
        { key: "api_key", label: m.ai_studio.api_key.label, secret: true, placeholder: m.ai_studio.api_key.placeholder },
        { key: "model", label: m.common.model.label, placeholder: "gemini-2.5-flash" },
      ],
    },
    {
      id: "vertex",
      name: "Google Vertex AI",
      help: m.vertex.help,
      fields: [
        { key: "service_account_json", label: m.vertex.service_account_json.label, secret: true, multiline: true, placeholder: m.vertex.service_account_json.placeholder },
        { key: "project_id", label: m.vertex.project_id.label, placeholder: "my-gcp-project" },
        { key: "location", label: m.vertex.location.label, placeholder: "us-central1" },
        { key: "api_key", label: m.vertex.api_key.label, secret: true, placeholder: m.vertex.api_key.placeholder },
        { key: "model", label: m.common.model.label, placeholder: "gemini-2.5-flash" },
      ],
    },
  ];
}

function AIProvidersSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const META = useAIProviderMeta();
  const [statuses, setStatuses] = useState<AIProviderStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AIProviderConfigInput>>({});
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, AITestResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    try { setStatuses(await api.listAIProviders()); }
    catch (e: any) { onError(e?.message ?? "Failed to load AI providers"); }
  }
  useEffect(() => { reload(); }, []);

  function setDraft(p: string, key: keyof AIProviderConfigInput, value: string) {
    setDrafts(prev => ({ ...prev, [p]: { ...(prev[p] || {}), [key]: value } }));
  }

  async function save(p: string) {
    onError(null);
    setMsgs(m => ({ ...m, [p]: "" }));
    setTests(s => ({ ...s, [p]: null }));
    const draft = drafts[p] || {};
    if (Object.keys(draft).length === 0) { onError("Nothing to save."); return; }
    try {
      await api.setAIProviderConfig(p, draft);
      setDrafts(prev => ({ ...prev, [p]: {} }));
      setMsgs(m => ({ ...m, [p]: t.common.saved }));
      await reload();
    } catch (e: any) { onError(e?.message ?? "Save failed"); }
  }

  async function clear(p: string) {
    if (!confirm(t.settings.ai.clearConfirm(p))) return;
    setTests(s => ({ ...s, [p]: null }));
    await api.clearAIProviderConfig(p);
    setMsgs(m => ({ ...m, [p]: t.common.cleared }));
    await reload();
  }

  async function test(p: string) {
    onError(null);
    setMsgs(m => ({ ...m, [p]: "" }));
    setBusy(p);
    try {
      const res = await api.testAIProvider(p);
      setTests(s => ({ ...s, [p]: res }));
    } catch (e: any) { onError(e?.message ?? "Test failed"); }
    finally { setBusy(null); }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t.settings.ai.title}</h2>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.ai.help}</p>
      <div className="grid lg:grid-cols-2 gap-4">
        {META.map(meta => {
          const status = statuses.find(s => s.provider === meta.id);
          const draft = drafts[meta.id] || {};
          const testRes = tests[meta.id];
          const msg = msgs[meta.id];
          const anyConfigured = Object.values(status?.fields ?? {}).some(f => f.configured);
          return (
            <div key={meta.id} className="border rounded-md p-4 dark:border-slate-700 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{meta.name}</h3>
                {anyConfigured ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">{t.settings.providers.configured}</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{t.settings.providers.notSet}</span>
                )}
                {/* Vertex accepts two auth modes; spell out which one the
                    stored config will actually use. */}
                {status?.auth_mode && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200">
                    {status.auth_mode === "service_account"
                      ? t.settings.ai.authServiceAccount
                      : t.settings.ai.authExpress}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{meta.help}</p>

              {meta.fields.map(f => {
                const cur = status?.fields?.[f.key];
                return (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs font-medium">{f.label}</label>
                    {cur?.configured && (
                      <div className="text-xs text-slate-600 dark:text-slate-400 break-all">
                        {cur.last4
                          ? t.settings.providers.savedSecret(cur.last4, cur.length ?? 0)
                          : cur.value
                            ? t.settings.providers.savedPlain(cur.value)
                            : t.settings.providers.savedNoDetail}
                      </div>
                    )}
                    {f.multiline ? (
                      <textarea
                        rows={4}
                        autoComplete="off"
                        value={draft[f.key] ?? ""}
                        onChange={e => setDraft(meta.id, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs font-mono"
                      />
                    ) : (
                      <input
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        value={draft[f.key] ?? ""}
                        onChange={e => setDraft(meta.id, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm"
                      />
                    )}
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => save(meta.id)}
                  className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm">{t.common.save}</button>
                <button disabled={busy === meta.id} onClick={() => test(meta.id)}
                  className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm disabled:opacity-50">
                  {busy === meta.id ? t.settings.ai.testing : t.common.test}
                </button>
                <button onClick={() => clear(meta.id)}
                  className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm text-red-600 dark:text-red-400">{t.common.clear}</button>
              </div>
              {msg && <div className="text-xs text-emerald-700 dark:text-emerald-300">{msg}</div>}
              {testRes && (
                <div className="text-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded px-3 py-2 space-y-0.5">
                  <div>{t.settings.ai.testOk(testRes.model ?? "")}</div>
                  {testRes.text && <div className="font-mono">“{testRes.text}”</div>}
                  {(testRes.prompt_tokens != null || testRes.completion_tokens != null) && (
                    <div className="text-slate-600 dark:text-slate-400">
                      {t.settings.ai.testTokens(testRes.prompt_tokens ?? 0, testRes.completion_tokens ?? 0)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.ai.testNote}</p>
    </section>
  );
}


/* ------------- Cost rates section ------------- */

const RATE_PROVIDER_NAMES: Record<string, string> = {
  serpapi: "SerpAPI",
  brightdata: "Bright Data",
  oxylabs: "Oxylabs",
  dataforseo: "DataForSEO",
};

function RatesSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [data, setData] = useState<ProviderRates | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getRates().then(setData).catch((e) => onError(e?.message ?? "Failed to load rates"));
  }, []);

  async function save() {
    setBusy(true); setMsg(null); onError(null);
    try {
      // Only send fields the user actually touched; "" resets to the default.
      const next = await api.setRates(drafts);
      setData(next);
      setDrafts({});
      setMsg(t.common.saved);
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  if (!data) return null;

  return (
    <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
      <h2 className="font-medium">{t.settings.rates.title}</h2>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.rates.help}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.keys(data.defaults).map((p) => {
          const current = data.rates[p];
          const isDefault = current === data.defaults[p];
          return (
            <div key={p} className="space-y-1">
              <label className="text-xs font-medium">{RATE_PROVIDER_NAMES[p] ?? p}</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-600 dark:text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={drafts[p] ?? String(current ?? "")}
                  onChange={(e) => setDrafts({ ...drafts, [p]: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm font-mono"
                />
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                {isDefault
                  ? t.settings.rates.usingDefault
                  : t.settings.rates.defaultIs(String(data.defaults[p]))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={busy || Object.keys(drafts).length === 0}
          onClick={save}
          className="px-4 py-2 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm disabled:opacity-50"
        >{t.common.save}</button>
        {msg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{msg}</span>}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t.settings.rates.footnote}</p>
    </section>
  );
}


/* ------------- Provider credentials section ------------- */

type ProviderId = "serpapi" | "brightdata" | "oxylabs" | "dataforseo";

type ProviderFieldKey = keyof ProviderCredsInput;

type ProviderMeta = {
  id: ProviderId;
  name: string;
  help: string;
  fields: { key: ProviderFieldKey; label: string; placeholder?: string; secret?: boolean }[];
};

function useProviderMeta(): ProviderMeta[] {
  const { t } = useT();
  const m = t.settings.providers.meta;
  return [
    {
      id: "serpapi",
      name: "SerpAPI",
      help: m.serpapi.help,
      fields: [{ key: "api_key", label: m.serpapi.api_key.label, secret: true, placeholder: m.serpapi.api_key.placeholder }],
    },
    {
      id: "brightdata",
      name: "Bright Data",
      help: m.brightdata.help,
      fields: [
        { key: "token", label: m.brightdata.token.label, secret: true, placeholder: m.brightdata.token.placeholder },
        { key: "zone", label: m.brightdata.zone.label, placeholder: m.brightdata.zone.placeholder },
        { key: "zone_raw", label: m.brightdata.zone_raw.label, placeholder: m.brightdata.zone_raw.placeholder },
      ],
    },
    {
      id: "oxylabs",
      name: "Oxylabs",
      help: m.oxylabs.help,
      fields: [
        { key: "username", label: m.oxylabs.username.label, placeholder: m.oxylabs.username.placeholder },
        { key: "password", label: m.oxylabs.password.label, secret: true, placeholder: m.oxylabs.password.placeholder },
      ],
    },
    {
      id: "dataforseo",
      name: "DataForSEO",
      help: m.dataforseo.help,
      fields: [
        { key: "login", label: m.dataforseo.login.label, placeholder: m.dataforseo.login.placeholder },
        { key: "password", label: m.dataforseo.password.label, secret: true, placeholder: m.dataforseo.password.placeholder },
      ],
    },
  ];
}

function ProvidersSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const PROVIDER_META = useProviderMeta();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ProviderCredsInput>>({});
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, any>>({});

  async function reload() {
    try { setStatuses(await api.listProviderStatuses()); }
    catch (e: any) { onError(e?.message ?? "Failed to load providers"); }
  }
  useEffect(() => { reload(); }, []);

  function setDraft(provider: string, key: keyof ProviderCredsInput, value: string) {
    setDrafts(prev => ({ ...prev, [provider]: { ...(prev[provider] || {}), [key]: value } }));
  }

  async function save(provider: string) {
    onError(null);
    setMsgs(m => ({ ...m, [provider]: "" }));
    setTests(t => ({ ...t, [provider]: null }));
    const draft = drafts[provider] || {};
    if (Object.keys(draft).length === 0) { onError("Nothing to save."); return; }
    try {
      await api.setProviderCreds(provider, draft);
      setDrafts(prev => ({ ...prev, [provider]: {} }));
      setMsgs(m => ({ ...m, [provider]: t.common.saved }));
      await reload();
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    }
  }

  async function clear(provider: string) {
    if (!confirm(t.settings.providers.clearConfirm(provider))) return;
    setTests(t => ({ ...t, [provider]: null }));
    await api.clearProviderCreds(provider);
    setMsgs(m => ({ ...m, [provider]: t.common.cleared }));
    await reload();
  }

  async function test(provider: string) {
    onError(null);
    setMsgs(m => ({ ...m, [provider]: "" }));
    try {
      const r = await api.testProvider(provider);
      setTests(t => ({ ...t, [provider]: r }));
    } catch (e: any) {
      onError(e?.message ?? "Test failed");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t.settings.providers.title}</h2>
      <div className="grid lg:grid-cols-3 gap-4">
        {PROVIDER_META.map(meta => {
          const status = statuses.find(s => s.provider === meta.id);
          const draft = drafts[meta.id] || {};
          const testRes = tests[meta.id];
          const msg = msgs[meta.id];
          return (
            <div key={meta.id} className="border rounded-md p-4 dark:border-slate-700 space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{meta.name}</h3>
                {status?.fields && Object.values(status.fields).every(f => f.configured) ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">{t.settings.providers.configured}</span>
                ) : Object.values(status?.fields ?? {}).some(f => f.configured) ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200">{t.settings.providers.partial}</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{t.settings.providers.notSet}</span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{meta.help}</p>

              {meta.fields.map(f => {
                const cur = status?.fields?.[f.key];
                return (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs font-medium">{f.label}</label>
                    {cur?.configured && (
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        {cur.last4 ? t.settings.providers.savedSecret(cur.last4, cur.length ?? 0) :
                          cur.value ? t.settings.providers.savedPlain(cur.value) : t.settings.providers.savedNoDetail}
                      </div>
                    )}
                    <input
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      value={draft[f.key] ?? ""}
                      onChange={e => setDraft(meta.id, f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 text-sm"
                    />
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => save(meta.id)}
                  className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm">{t.common.save}</button>
                <button onClick={() => test(meta.id)}
                  className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm">{t.common.test}</button>
                <button onClick={() => clear(meta.id)}
                  className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm text-red-600 dark:text-red-400">{t.common.clear}</button>
              </div>
              {msg && <div className="text-xs text-emerald-700 dark:text-emerald-300">{msg}</div>}
              {testRes && (
                <div className="text-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded px-3 py-2">
                  {t.settings.providers.worksOk(meta.name)}
                  {testRes.plan && t.settings.providers.plan(testRes.plan)}
                  {testRes.searches_left != null && t.settings.providers.searchesLeft(testRes.searches_left)}
                  {testRes.balance != null && t.settings.providers.balance(testRes.balance)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

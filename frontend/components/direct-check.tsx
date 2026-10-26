"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, DirectCheck } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Pill, SectionTitle, Switch, serverTime } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Checking chosen domains for blocks on a timer, whether or not any SERP was
 * checked (user, 2026-10-26: "check the domains for blocks even when the SERP
 * was not checked … When the settings is on, let the user select which domains
 * to check in a specified interval (they can select or choose all). The GEOs
 * will be taken from the Project GEOs if specified").
 *
 * Which domains and which of the project's GEOs — "all" by default, which
 * also covers ones added to the project later (user, 2026-10-26: "Let the user
 * choose GEOs as well") — and, with the timer on, how often. The answers land
 * in the Blocks table above like any other. Nothing changes until "Save".
 *
 * "Check now" sends the domains picked here once, whether or not the timer is
 * on and whether or not the choice is saved (user, asked for "a one-time
 * check": "I meant check now").
 */

const CHIP = "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition";
const CHIP_ON = "border-slate-900 bg-slate-900 font-medium text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900";
// Not picked: plain, not struck through (user, 2026-10-26: "they should not
// be strikethroughed either").
const CHIP_OFF = "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800";
const HINT = "text-xs text-slate-600 dark:text-slate-400";

export function DirectCheckCard({ projectId, reloadKey = 0, onChanged }: {
  projectId: number;
  /** Bumped when the project's GEOs were saved: the GEOs are chosen among them. */
  reloadKey?: number;
  /** Something was sent here that the tables on this tab read. */
  onChanged?: () => void;
}) {
  const { t } = useT();
  const x = t.tools.direct;
  const p = t.tools.project;
  const [data, setData] = useState<DirectCheck | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState(24);
  const [all, setAll] = useState(true);
  // The domains switched on, while "all" is not. Unticking "all" starts from
  // none (user, 2026-10-26: "When this box is not on, none of the domains
  // should be selected").
  const [chosen, setChosen] = useState<string[]>([]);
  // The same for the GEOs.
  const [allGeos, setAllGeos] = useState(true);
  const [chosenGeos, setChosenGeos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function take(next: DirectCheck) {
    setData(next);
    setEnabled(next.enabled);
    setHours(next.hours);
    setAll(next.domains === null);
    setChosen(next.domains ?? []);
    setAllGeos(next.geos === null);
    setChosenGeos(next.geos ?? []);
  }
  useEffect(() => {
    api.getDirectCheck(projectId).then(take).catch(e => setErr(e?.message ?? String(e)));
  }, [projectId, reloadKey]);

  if (!data) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const differs = (a: string[], b: string[]) => a.length !== b.length || a.some(v => !b.includes(v));
  const dirty = enabled !== data.enabled || hours !== data.hours
    || all !== (data.domains === null) || (!all && differs(chosen, data.domains ?? []))
    || allGeos !== (data.geos === null) || (!allGeos && differs(chosenGeos, data.geos ?? []));
  const checking = all ? data.project_domains : data.project_domains.filter(d => chosen.includes(d));
  const checkingGeos = allGeos ? data.project_geos : data.project_geos.filter(g => chosenGeos.includes(g));
  const next = serverTime(data.next_run);
  const last = serverTime(data.last_at);
  const toggle = (d: string) => {
    setChosen(chosen.includes(d) ? chosen.filter(c => c !== d) : [...chosen, d]);
    setMsg(null);
  };
  const toggleGeo = (g: string) => {
    setChosenGeos(chosenGeos.includes(g) ? chosenGeos.filter(c => c !== g) : [...chosenGeos, g]);
    setMsg(null);
  };

  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      take(await api.saveDirectCheck(projectId, {
        enabled, hours, domains: all ? null : checking, geos: allGeos ? null : checkingGeos,
      }));
      setMsg(t.common.saved);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  async function checkNow() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await api.runDirectCheck(projectId, all ? null : checking, allGeos ? null : checkingGeos);
      // The answer carries the saved setting; what is picked here but not
      // saved yet stays picked.
      setData(res);
      onChanged?.();
      setMsg(res.sent.length === 0
        ? p.nothingToSend
        : `${p.sentResult(res.sent.filter(d => d.ok).length, res.sent.length)} ${x.resultMore}`);
    } catch (e: any) {
      setErr(e?.message ?? "Check failed");
    } finally { setBusy(false); }
  }

  return (
    <Card
      title={<SectionTitle icon="clock">{x.title}</SectionTitle>}
      actions={
        data.enabled
          ? <Pill tone="good" icon="check">{x.every(data.hours)}</Pill>
          : <Pill tone="neutral" icon="dash">{x.off}</Pill>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{x.help}</p>

        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={enabled} onChange={on => { setEnabled(on); setMsg(null); }} label={x.toggle} />
          {x.toggle}
        </label>

        {enabled && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{x.howOften}</div>
            <select
              value={hours}
              onChange={e => { setHours(Number(e.target.value)); setMsg(null); }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {data.hours_choices.map(h => <option key={h} value={h}>{x.every(h)}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">{x.domains}</div>
          {data.project_domains.length === 0 ? (
            <p className={HINT}>{x.noDomains}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={e => {
                    setAll(e.target.checked);
                    // Choosing by hand starts from none switched on.
                    if (!e.target.checked) setChosen([]);
                    setMsg(null);
                  }}
                />
                {x.allDomains}
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.project_domains.map(d => {
                  const on = all || chosen.includes(d);
                  const amp = data.amp[d] ?? [];
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={all}
                      onClick={() => toggle(d)}
                      aria-pressed={on}
                      title={amp.length > 0 ? x.ampTitle(amp.join(", ")) : undefined}
                      className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} ${all ? "cursor-default opacity-80" : ""}`}
                    >
                      <span className="font-mono">{d}</span>
                      {amp.length > 0 && <span className="text-[10px] font-semibold opacity-70">+AMP</span>}
                    </button>
                  );
                })}
              </div>
              <p className={HINT}>
                {checking.length === 0 ? x.noneChosen : all ? x.allHint : x.domainsHint}
              </p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">GEO</div>
          {data.project_geos.length === 0 ? (
            <p className={HINT}>{x.geosNone}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allGeos}
                  onChange={e => {
                    setAllGeos(e.target.checked);
                    // Choosing by hand starts from none switched on, as with the domains.
                    if (!e.target.checked) setChosenGeos([]);
                    setMsg(null);
                  }}
                />
                {x.allGeos}
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.project_geos.map(g => {
                  const on = allGeos || chosenGeos.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      disabled={allGeos}
                      onClick={() => toggleGeo(g)}
                      aria-pressed={on}
                      className={`${CHIP} font-mono ${on ? CHIP_ON : CHIP_OFF} ${allGeos ? "cursor-default opacity-80" : ""}`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
              <p className={HINT}>
                {checkingGeos.length === 0 ? x.noGeoChosen : allGeos ? x.allGeosHint : x.geosHint}
                {" "}{data.geos_set ? x.geosFromProject : x.geosFromJobs}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>{t.common.save}</Button>
          <Button
            size="sm"
            disabled={busy || !data.connected || checking.length === 0 || checkingGeos.length === 0}
            onClick={checkNow}
            title={x.checkNowHint}
          >
            <Icon name="play" className="h-3.5 w-3.5" />
            {busy ? x.checking : x.checkNow}
          </Button>
          {msg && <span className="text-sm text-slate-700 dark:text-slate-300">{msg}</span>}
        </div>
        <p className={HINT}>
          {enabled ? x.onHint(x.every(hours)) : x.offHint}
          {data.enabled && !dirty && next && <> {x.nextRun(next.toLocaleString())}</>}
          {last && <> {x.lastAt(last.toLocaleString())}</>}
        </p>
        {!data.connected && (
          <p className={HINT}>
            {p.notConnected}{" "}
            <Link href="/settings#tools" className="underline underline-offset-2">{p.connectLink}</Link>
          </p>
        )}
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
      </div>
    </Card>
  );
}

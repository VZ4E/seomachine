"use client";
import { useEffect, useState } from "react";
import type { CaseFile } from "@/lib/engine/caseTypes";
import { loadTrial, saveTrial } from "@/lib/career";
import { acquittedCounts, applyPriorRulings, initRetrial, retriableCounts, type PriorTrial, type TrialState } from "@/lib/engine/state";
import { parsePriorTrial } from "@/lib/engine/transcriptImport";
import PriorTrialNotes from "./PriorTrialNotes";

/**
 * The case file is server-rendered from the case JSON, but a player's trial lives in localStorage.
 * This reads the save after mount and returns a retrial-shaped view of it when there is one:
 * either a retrial already underway, or a finished trial that hung and can be retried.
 */
function useRetrialView(c: CaseFile) {
  const [view, setView] = useState<{ s: TrialState; started: boolean } | null>(null);
  useEffect(() => {
    const saved = loadTrial(c.id);
    if (!saved) return;
    if (saved.retrial) setView({ s: saved, started: saved.phase !== "verdict" || !saved.deliberation });
    else if (saved.phase === "verdict" && retriableCounts(saved)) setView({ s: initRetrial(c, saved, 0), started: false });
  }, [c]);
  return view;
}

const names = (c: CaseFile, ids: string[]) => ids.map((id) => c.charges.find((x) => x.id === id)?.name ?? id);

export function RetrialBanner({ c }: { c: CaseFile }) {
  const v = useRetrialView(c);
  const [s, setS] = useState<TrialState | null>(null);
  useEffect(() => { setS(v?.s ?? null); }, [v]);
  if (!v || !s?.retrial) return null;
  const r = s.retrial;
  // Saves from the first cut of the retrial feature lack acquittedNames and prior.
  const acquittedNames = r.acquittedNames ?? names(c, r.acquitted);
  const live = c.charges.filter((x) => !r.acquitted.includes(x.id)).map((x) => x.name);
  const hasRecord = (r.prior?.length ?? 0) > 0;

  return (
    <section className="panel border-caution/50 p-5 lg:col-span-3">
      <p className="text-sm uppercase tracking-[0.25em] text-caution">{v.started ? `Retrial in progress · round ${r.round}` : `Mistrial · retrial available`}</p>
      <p className="mt-2 text-sm">
        The jury hung on <b>{live.join(", ")}</b>. Your client was acquitted of <b>{acquittedNames.join(", ")}</b>. Those acquittals are final under the Double Jeopardy Clause, so the State can retry only the hung {live.length === 1 ? "count" : "counts"}. The case file below is unchanged, but read it knowing that {live.length === 1 ? "one count is" : `${live.length} counts are`} all that remain.
      </p>
      {!v.started && <p className="mt-2 text-xs text-ink">Enter the courtroom and choose “Retry the hung count” on the verdict screen to begin round {r.round}.</p>}
      {hasRecord ? (
        <div className="mt-4"><PriorTrialNotes c={c} s={s} /></div>
      ) : (
        <AttachTranscript c={c} s={s} onAttached={setS} />
      )}
    </section>
  );
}

/** A retrial with no record of the last trial: let the player paste the transcript to rebuild it. */
type Ruling = PriorTrial["motionsHeard"][string] | "";
const RULINGS: Array<[Ruling, string]> = [["", "not argued"], ["granted", "granted"], ["granted-in-part", "granted in part"], ["denied", "denied"]];

function AttachTranscript({ c, s, onAttached }: { c: CaseFile; s: TrialState; onAttached: (s: TrialState) => void }) {
  const [text, setText] = useState("");
  const [rulings, setRulings] = useState<Record<string, Ruling>>({});
  const r = s.retrial!;
  const attach = () => {
    const motionsHeard: PriorTrial["motionsHeard"] = {};
    for (const [name, v] of Object.entries(rulings)) if (v) motionsHeard[name] = v;
    const prior = parsePriorTrial(c, text, { round: r.round - 1, acquitted: r.acquitted, motionsHeard });
    const withRecord: TrialState = { ...s, retrial: { ...r, acquittedNames: r.acquittedNames ?? names(c, r.acquitted), prior: [...(r.prior ?? []), prior] } };
    const next = applyPriorRulings(c, withRecord, prior); // law of the case: granted motions and exclusions carry into this round
    saveTrial(next);
    onAttached(next);
    window.location.reload(); // the evidence and motion badges read the save on mount
  };
  return (
    <div className="mt-4 rounded-lg border border-wood-600 p-3 text-xs">
      <p className="font-semibold text-brass">No record of trial {r.round - 1} is attached.</p>
      <p className="mt-1 text-ink">
        This retrial was started before the sim kept the first trial&apos;s record. Paste the transcript from trial {r.round - 1} (and the verdict screen above it, if you have it) and it becomes the sworn record: the notes here, and what the court and witnesses are held to in round {r.round}.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"— PRETRIAL —\nDefense (You): …\nJudge …: …"} className="mt-2 w-full rounded border border-wood-600 bg-black/30 p-2 font-mono text-[11px]" />
      <p className="mt-3 font-semibold text-brass">How did the judge rule on each motion in trial {r.round - 1}?</p>
      <p className="text-ink">Granted rulings are law of the case: they carry into round {r.round} and their evidence stays excluded. Denied motions can be re-argued on new grounds.</p>
      <ul className="mt-1 space-y-1">
        {c.pretrialMotions.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">{m.name}</span>
            <select value={rulings[m.name] ?? ""} onChange={(e) => setRulings({ ...rulings, [m.name]: e.target.value as Ruling })} className="rounded border border-wood-600 bg-black/30 px-1 py-0.5 text-[11px]">
              {RULINGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <button onClick={attach} disabled={!text.trim()} className="brass-btn mt-2 px-3 py-1 text-xs disabled:opacity-50">Attach as trial {r.round - 1} record</button>
    </div>
  );
}

/** Badge for an evidence card: shows what the last trial did with it, and whether that ruling still binds. */
export function EvidenceStatus({ c, evidenceId }: { c: CaseFile; evidenceId: string }) {
  const v = useRetrialView(c);
  const prior = v?.s.retrial?.prior?.at(-1);
  if (!v || !prior) return null;
  const round = prior.round;
  if (v.s.excluded.includes(evidenceId) || prior.excluded.includes(evidenceId)) {
    return <p className="mt-1 rounded bg-acquit/15 px-2 py-1 text-xs font-semibold text-acquit">Excluded in trial {round} · law of the case, stays out in round {v.s.retrial!.round}</p>;
  }
  if (prior.admitted.includes(evidenceId)) return <p className="mt-1 rounded bg-guilty/15 px-2 py-1 text-xs font-semibold text-guilty">Admitted in trial {round} · expect the State to offer it again</p>;
  return null;
}

/** Badge for a pretrial motion: last time's ruling and what it means for this round. */
export function MotionStatus({ c, motionName }: { c: CaseFile; motionName: string }) {
  const v = useRetrialView(c);
  const prior = v?.s.retrial?.prior?.at(-1);
  if (!v || !prior) return null;
  const r = prior.motionsHeard[motionName];
  if (!r) return <p className="mt-1 text-xs text-ink">Not argued in trial {prior.round}. Still available.</p>;
  if (r === "denied") return <p className="mt-1 text-xs font-semibold text-caution">Denied in trial {prior.round} · re-argue only with new grounds</p>;
  return <p className="mt-1 text-xs font-semibold text-acquit">{r === "granted" ? "Granted" : "Granted in part"} in trial {prior.round} · the ruling stands in round {v.s.retrial!.round}</p>;
}

/** Badge for a charge card: greys out counts the defendant can no longer be tried on. */
export function ChargeStatus({ c, chargeId }: { c: CaseFile; chargeId: string }) {
  const v = useRetrialView(c);
  if (!v) return null;
  const gone = acquittedCounts(v.s).includes(chargeId);
  const prior = v.s.retrial?.prior?.at(-1);
  const round = prior?.round ?? (v.s.retrial?.round ?? 2) - 1;
  const last = prior?.verdicts.find((x) => x.chargeId === chargeId);
  if (gone) return <p className="mt-2 rounded bg-acquit/15 px-2 py-1 text-xs font-semibold text-acquit">Acquitted in trial {round}{last ? ` (${last.votesNotGuilty}–${12 - last.votesNotGuilty} NG)` : ""} · cannot be retried</p>;
  if (!prior || last?.result === "hung") return <p className="mt-2 rounded bg-caution/15 px-2 py-1 text-xs font-semibold text-caution">Hung jury in trial {round}{last ? ` (${last.votesNotGuilty}–${12 - last.votesNotGuilty} NG)` : ""} · on trial again</p>;
  return null;
}

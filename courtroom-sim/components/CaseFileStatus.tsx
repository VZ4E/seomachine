"use client";
import { useEffect, useState } from "react";
import type { CaseFile } from "@/lib/engine/caseTypes";
import { loadTrial, saveTrial } from "@/lib/career";
import { acquittedCounts, initRetrial, retriableCounts, type TrialState } from "@/lib/engine/state";
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
function AttachTranscript({ c, s, onAttached }: { c: CaseFile; s: TrialState; onAttached: (s: TrialState) => void }) {
  const [text, setText] = useState("");
  const r = s.retrial!;
  const attach = () => {
    const prior = parsePriorTrial(c, text, { round: r.round - 1, acquitted: r.acquitted });
    const next: TrialState = { ...s, retrial: { ...r, acquittedNames: r.acquittedNames ?? names(c, r.acquitted), prior: [...(r.prior ?? []), prior] } };
    saveTrial(next);
    onAttached(next);
  };
  return (
    <div className="mt-4 rounded-lg border border-wood-600 p-3 text-xs">
      <p className="font-semibold text-brass">No record of trial {r.round - 1} is attached.</p>
      <p className="mt-1 text-ink">
        This retrial was started before the sim kept the first trial&apos;s record. Paste the transcript from trial {r.round - 1} (and the verdict screen above it, if you have it) and it becomes the sworn record: the notes here, and what the court and witnesses are held to in round {r.round}.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"— PRETRIAL —\nDefense (You): …\nJudge …: …"} className="mt-2 w-full rounded border border-wood-600 bg-black/30 p-2 font-mono text-[11px]" />
      <button onClick={attach} disabled={!text.trim()} className="brass-btn mt-2 px-3 py-1 text-xs disabled:opacity-50">Attach as trial {r.round - 1} record</button>
    </div>
  );
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

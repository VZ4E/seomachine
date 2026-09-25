"use client";
import { useEffect, useState } from "react";
import type { CaseFile } from "@/lib/engine/caseTypes";
import { loadTrial } from "@/lib/career";
import { acquittedCounts, initRetrial, retriableCounts, type TrialState } from "@/lib/engine/state";
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

export function RetrialBanner({ c }: { c: CaseFile }) {
  const v = useRetrialView(c);
  if (!v) return null;
  const r = v.s.retrial!;
  const live = c.charges.filter((x) => !r.acquitted.includes(x.id)).map((x) => x.name);
  return (
    <section className="panel border-caution/50 p-5 lg:col-span-3">
      <p className="text-sm uppercase tracking-[0.25em] text-caution">{v.started ? `Retrial in progress · round ${r.round}` : `Mistrial · retrial available`}</p>
      <p className="mt-2 text-sm">
        The jury hung on <b>{live.join(", ")}</b>. Your client was acquitted of <b>{r.acquittedNames.join(", ")}</b>. Those acquittals are final under the Double Jeopardy Clause, so the State can retry only the hung {live.length === 1 ? "count" : "counts"}. The case file below is unchanged, but read it knowing that {live.length === 1 ? "one count is" : `${live.length} counts are`} all that remain.
      </p>
      {!v.started && <p className="mt-2 text-xs text-ink">Enter the courtroom and choose “Retry the hung count” on the verdict screen to begin round {r.round}.</p>}
      <div className="mt-4"><PriorTrialNotes c={c} s={v.s} /></div>
    </section>
  );
}

/** Badge for a charge card: greys out counts the defendant can no longer be tried on. */
export function ChargeStatus({ c, chargeId }: { c: CaseFile; chargeId: string }) {
  const v = useRetrialView(c);
  if (!v) return null;
  const gone = acquittedCounts(v.s).includes(chargeId);
  const prior = v.s.retrial?.prior?.at(-1);
  const last = prior?.verdicts.find((x) => x.chargeId === chargeId);
  if (gone) return <p className="mt-2 rounded bg-acquit/15 px-2 py-1 text-xs font-semibold text-acquit">Acquitted in trial {prior?.round ?? 1}{last ? ` (${last.votesNotGuilty}–${12 - last.votesNotGuilty} NG)` : ""} · cannot be retried</p>;
  if (last?.result === "hung") return <p className="mt-2 rounded bg-caution/15 px-2 py-1 text-xs font-semibold text-caution">Hung jury in trial {prior?.round ?? 1} ({last.votesNotGuilty}–{12 - last.votesNotGuilty} NG) · on trial again</p>;
  return null;
}

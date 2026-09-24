"use client";
import Link from "next/link";
import type { CaseFile } from "@/lib/engine/caseTypes";
import { grade, outcomeOf, trialPoints } from "@/lib/engine/scoring";
import type { TrialState } from "@/lib/engine/state";

const LABEL = { "not-guilty": "NOT GUILTY", guilty: "GUILTY", hung: "HUNG JURY", "guilty-lesser": "GUILTY (lesser)" } as const;
const COLOR = { "not-guilty": "text-acquit", guilty: "text-guilty", hung: "text-caution", "guilty-lesser": "text-caution" } as const;
const HEADLINE = { acquittal: "Your client walks free.", hung: "Mistrial: the jury is hung.", partial: "A split verdict.", conviction: "Your client is convicted." };

export default function Verdict({ c, s, onRestart }: { c: CaseFile; s: TrialState; onRestart: () => void }) {
  const d = s.deliberation!;
  const outcome = outcomeOf(d, s.dismissedCounts);
  const pts = trialPoints(s, outcome);
  const g = grade(pts, outcome);
  const top = [...s.score].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-6">
      <div className="panel p-6 text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-brass">The jury has reached a verdict</p>
        <h1 className="mt-2 font-serif text-4xl font-bold">{HEADLINE[outcome]}</h1>
        <div className="mt-4 space-y-1">
          {d.verdicts.map((v) => {
            const ch = c.charges.find((x) => x.id === v.chargeId);
            return (
              <p key={v.chargeId} className="font-serif text-xl">
                {ch?.name ?? v.chargeId}: <span className={`font-bold ${COLOR[v.result]}`}>{LABEL[v.result]}{v.lesser ? ` — ${v.lesser}` : ""}</span>
                <span className="ml-2 text-sm text-ink">({v.votesNotGuilty}–{12 - v.votesNotGuilty} NG)</span>
              </p>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-ink">Foreperson {d.foreperson} · Deciding factor: {d.keyFactor}</p>
        <div className="mt-5 inline-flex items-center gap-6 rounded-lg border border-brass/40 px-6 py-3">
          <div><p className="text-xs text-ink">Grade</p><p className="font-serif text-4xl text-brass">{g}</p></div>
          <div><p className="text-xs text-ink">Career points</p><p className="font-serif text-3xl">{pts}</p></div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="panel p-5">
          <h2 className="mb-2 font-serif text-2xl">Inside the jury room</h2>
          <div className="scrollbar-thin max-h-80 space-y-2 overflow-y-auto text-sm">
            {d.transcript.map((l, i) => <p key={i}><span className="font-semibold text-violet-300">{l.name}:</span> {l.text}</p>)}
          </div>
        </div>
        <div className="panel p-5">
          <h2 className="mb-2 font-serif text-2xl">Senior partner&apos;s critique</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{d.critique.map((x) => <li key={x}>{x}</li>)}</ul>
          <h3 className="mt-4 font-serif text-lg">Scorecard</h3>
          <ul className="space-y-0.5 text-xs">
            {top.map((e, i) => (
              <li key={i} className="flex justify-between gap-2"><span>{e.label}</span><span className={e.points >= 0 ? "text-acquit" : "text-guilty"}>{e.points > 0 ? "+" : ""}{e.points}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink">
            Objections {s.objections.sustained}/{s.objections.made} sustained · {s.revealed.length} hidden facts exposed · {s.excluded.length} exhibits excluded · {s.contempt} contempt warnings
          </p>
        </div>
      </div>

      <div className="panel p-5">
        <p className="text-sm uppercase tracking-[0.25em] text-brass">The real case</p>
        <h2 className="font-serif text-2xl">{c.basedOn.name} ({c.basedOn.year})</h2>
        <p className="mt-2 text-sm">{c.basedOn.summary}</p>
        <p className="mt-2 text-sm"><span className="font-semibold text-brass">What really happened:</span> {c.basedOn.realOutcome}</p>
        <ul className="mt-2 list-disc pl-5 text-sm">{c.basedOn.keyLessons.map((k) => <li key={k}>{k}</li>)}</ul>
        <p className="mt-3 text-xs text-ink">
          Sources: {c.basedOn.sources.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 underline hover:text-brass">[{i + 1}]</a>)}
        </p>
      </div>

      <div className="flex justify-center gap-3">
        <Link href="/" className="brass-btn">Back to docket</Link>
        <button onClick={onRestart} className="ghost-btn">Retry this case</button>
      </div>
    </div>
  );
}

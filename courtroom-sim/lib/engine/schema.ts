// Type-safe contract between the model and the game. The model must return JSON matching
// these schemas; the server validates with zod and clamps anything out of range.
import { z } from "zod";

export const SPEAKERS = ["judge", "prosecutor", "witness", "clerk", "bailiff", "juror", "defendant"] as const;

export const CourtLine = z.object({
  speaker: z.enum(SPEAKERS),
  name: z.string().describe("Display name, e.g. 'Judge Harlan' or 'Det. Ruiz'"),
  text: z.string(),
});

export const Ruling = z.object({
  on: z.string().describe("What was ruled on: objection ground, motion name, bail, challenge"),
  result: z.enum(["sustained", "overruled", "granted", "denied", "granted-in-part"]),
  reason: z.string().describe("One sentence legal basis, citing the rule"),
  favorsDefense: z.boolean(),
});

export const CourtTurn = z.object({
  lines: z.array(CourtLine).describe("Dialogue in order. 1-6 lines."),
  ruling: Ruling.nullable(),
  prosecutorObjected: z.boolean().describe("True if the prosecutor objected to the defense this turn"),
  evidenceAdmitted: z.array(z.string()).describe("Evidence ids admitted this turn"),
  evidenceExcluded: z.array(z.string()).describe("Evidence ids excluded/suppressed this turn"),
  factsRevealed: z
    .array(z.object({ witnessId: z.string(), fact: z.string() }))
    .describe("Hidden facts or prior-statement contradictions the defense exposed this turn"),
  jurorReactions: z
    .array(z.object({ seat: z.number().int(), delta: z.number().int(), reason: z.string() }))
    .describe("Seated juror lean changes, -10..10; positive = toward NOT GUILTY. Empty when the jury is absent."),
  scoreEvents: z
    .array(z.object({ label: z.string(), points: z.number().int() }))
    .describe("Advocacy feedback, -10..10 each, e.g. 'Effective impeachment' +6, 'Leading on direct' -2"),
  jurorsRevealed: z.array(z.number().int()).describe("Venire numbers whose hidden bias came out in voir dire"),
  contemptWarning: z.boolean(),
  witnessExcused: z.boolean().describe("True when the examination of the current witness is finished"),
  countsDismissed: z.array(z.string()).describe("Charge ids dismissed or acquitted by the judge (Rule 29)"),
});
export type CourtTurn = z.infer<typeof CourtTurn>;
export type CourtLineT = z.infer<typeof CourtLine>;
export type RulingT = z.infer<typeof Ruling>;

export const Deliberation = z.object({
  transcript: z
    .array(z.object({ seat: z.number().int(), name: z.string(), text: z.string() }))
    .describe("8-14 lines of jury-room debate"),
  verdicts: z.array(
    z.object({
      chargeId: z.string(),
      result: z.enum(["guilty", "not-guilty", "hung", "guilty-lesser"]),
      lesser: z.string().nullable(),
      votesNotGuilty: z.number().int(),
    }),
  ),
  foreperson: z.string(),
  keyFactor: z.string().describe("The single thing that most decided the verdict"),
  critique: z.array(z.string()).describe("3-5 coaching notes on the defense's performance"),
});
export type Deliberation = z.infer<typeof Deliberation>;

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Normalises model output so a misbehaving model can't break game balance. */
export function sanitizeTurn(t: CourtTurn, opts: { juryPresent: boolean; validEvidence: Set<string>; validCharges: Set<string> }): CourtTurn {
  return {
    ...t,
    lines: t.lines.slice(0, 8).filter((l) => l.text.trim()),
    evidenceAdmitted: t.evidenceAdmitted.filter((id) => opts.validEvidence.has(id)),
    evidenceExcluded: t.evidenceExcluded.filter((id) => opts.validEvidence.has(id)),
    jurorReactions: opts.juryPresent
      ? t.jurorReactions
          .filter((r) => r.seat >= 1 && r.seat <= 12)
          .map((r) => ({ ...r, delta: clampInt(r.delta, -10, 10) }))
      : [],
    scoreEvents: t.scoreEvents.slice(0, 4).map((e) => ({ ...e, points: clampInt(e.points, -10, 10) })),
    factsRevealed: t.factsRevealed.slice(0, 3),
    countsDismissed: t.countsDismissed.filter((id) => opts.validCharges.has(id)),
  };
}

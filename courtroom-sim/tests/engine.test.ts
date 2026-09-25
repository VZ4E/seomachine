import { describe, expect, it } from "vitest";
import { detectObjection } from "@/lib/engine/objections";
import { nextPhase, PHASES } from "@/lib/engine/phases";
import { generateVenire, doubtLevel, seated } from "@/lib/engine/jurors";
import { sanitizeTurn, type CourtTurn } from "@/lib/engine/schema";
import { activeCase, initRetrial, initTrial, reducer, retriableCounts, priorTrialRecord, type TrialState } from "@/lib/engine/state";
import { priorTrialNotes, turnPrompt } from "@/lib/engine/prompts";
import { grade, outcomeOf, rankFor, tierUnlocked } from "@/lib/engine/scoring";
import { mockDeliberation, mockTurn } from "@/lib/ai/mock";
import { publicCase } from "@/lib/engine/witness";
import { fixture as c } from "./fixture";

const blank = (over: Partial<CourtTurn> = {}): CourtTurn => ({
  lines: [], ruling: null, prosecutorObjected: false, evidenceAdmitted: [], evidenceExcluded: [], factsRevealed: [],
  jurorReactions: [], scoreEvents: [], jurorsRevealed: [], contemptWarning: false, witnessExcused: false, countsDismissed: [], ...over,
});

function toPhase(s: TrialState, id: TrialState["phase"]) {
  while (s.phase !== id) s = reducer(s, { type: "advance" });
  return s;
}

describe("objection detection", () => {
  it("recognises spoken grounds", () => {
    expect(detectObjection("Objection, hearsay!")?.ground?.id).toBe("hearsay");
    expect(detectObjection("objection your honor, leading the witness")?.ground?.id).toBe("leading");
    expect(detectObjection("Objection. 404(b), prior bad acts")?.ground?.id).toBe("character");
    expect(detectObjection("Objection")?.ground).toBeNull();
    expect(detectObjection("Where were you on the night of the 14th?")).toBeNull();
  });
});

describe("phases", () => {
  it("walks every phase in order and stops at verdict", () => {
    let p = PHASES[0].id;
    const seen = [p];
    for (let i = 0; i < 20; i++) { p = nextPhase(p); if (!seen.includes(p)) seen.push(p); }
    expect(seen).toEqual(PHASES.map((x) => x.id));
  });
});

describe("jurors", () => {
  it("generates a deterministic venire", () => {
    expect(generateVenire(42, 50)).toEqual(generateVenire(42, 50));
    expect(generateVenire(42, 50)).toHaveLength(18);
  });
  it("seats 12 after the State's strikes when voir dire ends", () => {
    let s = initTrial(c, 7);
    s = toPhase(s, "voir_dire");
    s = reducer(s, { type: "strike", jurorId: 1 });
    s = reducer(s, { type: "advance" });
    expect(seated(s.jurors)).toHaveLength(12);
    expect(s.jurors.filter((j) => j.status === "struck-prosecution")).toHaveLength(3);
    expect(s.jurors.find((j) => j.id === 1)!.status).toBe("struck-defense");
  });
});

describe("applyTurn", () => {
  it("applies juror deltas, exhibits, revealed facts and objection stats", () => {
    let s = toPhase(initTrial(c, 1), "prosecution_case");
    const before = doubtLevel(s.jurors);
    s = reducer(s, {
      type: "turn",
      objectionByDefense: true,
      turn: blank({
        ruling: { on: "Hearsay", result: "sustained", reason: "801", favorsDefense: true },
        jurorReactions: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, delta: 5, reason: "r" })),
        factsRevealed: [{ witnessId: "eyewitness", fact: "No glasses" }],
        evidenceAdmitted: ["gun"],
      }),
    });
    expect(doubtLevel(s.jurors)).toBeGreaterThan(before);
    expect(s.objections).toMatchObject({ made: 1, sustained: 1 });
    expect(s.revealed).toHaveLength(1);
    expect(s.admitted).toContain("gun");
    expect(s.score.reduce((a, e) => a + e.points, 0)).toBe(8);
  });

  it("records granted motions and keeps excluded evidence out", () => {
    let s = toPhase(initTrial(c, 1), "pretrial");
    s = reducer(s, { type: "turn", turn: blank({ ruling: { on: "Motion in Limine to Exclude Lyrics", result: "granted", reason: "403", favorsDefense: true }, evidenceExcluded: ["lyrics"] }) });
    s = reducer(s, { type: "turn", turn: blank({ evidenceAdmitted: ["lyrics"] }) });
    expect(s.admitted).not.toContain("lyrics");
    expect(s.motionsHeard["Motion in Limine to Exclude Lyrics"]).toBe("granted");
  });

  it("sanitize clamps deltas and drops unknown ids and absent-jury reactions", () => {
    const t = blank({ jurorReactions: [{ seat: 1, delta: 99, reason: "" }, { seat: 40, delta: 1, reason: "" }], evidenceExcluded: ["nope", "gun"] });
    const opts = { juryPresent: true, validEvidence: new Set(["gun"]), validCharges: new Set<string>() };
    const out = sanitizeTurn(t, opts);
    expect(out.jurorReactions).toEqual([{ seat: 1, delta: 10, reason: "" }]);
    expect(out.evidenceExcluded).toEqual(["gun"]);
    expect(sanitizeTurn(t, { ...opts, juryPresent: false }).jurorReactions).toEqual([]);
  });
});

describe("offline mock court", () => {
  it("plays a full trial from arraignment to verdict", () => {
    let s = initTrial(c, 3);
    const play = (input: Parameters<typeof mockTurn>[2]) => { s = reducer(s, { type: "turn", turn: mockTurn(c, s, input) }); };
    play({ kind: "proceed" });
    play({ kind: "speech", text: "Not guilty. We ask for release; he has family ties and a job." });
    expect(s.bail).toBe("released");
    s = reducer(s, { type: "advance" });
    play({ kind: "motion", motionId: "lyrics-motion", text: "These lyrics are artistic expression, not confessions. Under 403 their prejudicial effect in a gang case substantially outweighs any probative value, and the State offers them only to show propensity." });
    expect(s.excluded).toContain("lyrics");
    s = reducer(s, { type: "advance" });
    play({ kind: "speech", text: "Does anyone here think rap music glorifies violence?" });
    s = toPhase(s, "prosecution_case");
    s = reducer(s, { type: "callWitness", witnessId: "eyewitness", mode: "direct" });
    play({ kind: "proceed" });
    s = reducer(s, { type: "setExam", mode: "cross" });
    play({ kind: "speech", text: "It was dark and the streetlight was broken, and you weren't wearing your glasses, correct?" });
    expect(s.revealed.length).toBe(1);
    s = reducer(s, { type: "excuseWitness" });
    s = toPhase(s, "deliberation");
    const d = mockDeliberation(c, s);
    s = reducer(s, { type: "deliberated", result: d });
    expect(s.phase).toBe("verdict");
    expect(d.verdicts).toHaveLength(2);
  });
});

describe("scoring", () => {
  it("grades and ranks", () => {
    const d = { transcript: [], foreperson: "", keyFactor: "", critique: [], verdicts: [{ chargeId: "murder", result: "not-guilty" as const, lesser: null, votesNotGuilty: 12 }] };
    expect(outcomeOf(d, [])).toBe("acquittal");
    expect(outcomeOf({ ...d, verdicts: [{ ...d.verdicts[0], result: "guilty" }] }, ["murder"])).toBe("acquittal");
    expect(grade(80, "acquittal")).toBe("A+");
    expect(grade(10, "conviction")).toBe("F");
    expect(rankFor(260).name).toBe("Senior Trial Counsel");
    expect(tierUnlocked(3, 1, false)).toBe(false);
    expect(tierUnlocked(3, 0, true)).toBe(true);
  });
  it("hides witness hidden facts from the browser", () => {
    expect(publicCase(c).witnesses.every((w) => w.hiddenFacts.length === 0)).toBe(true);
  });
});

describe("retrial after a hung jury", () => {
  const verdict = (murder: "hung" | "not-guilty" | "guilty", gang: "hung" | "not-guilty" | "guilty") => ({
    transcript: [], foreperson: "", keyFactor: "", critique: [],
    verdicts: [
      { chargeId: "murder", result: murder, lesser: null, votesNotGuilty: 6 },
      { chargeId: "gang-enh", result: gang, lesser: null, votesNotGuilty: 6 },
    ],
  });
  it("offers a retrial only when a count hung and nothing was a conviction", () => {
    const base = initTrial(c, 1);
    expect(retriableCounts({ ...base, deliberation: verdict("hung", "not-guilty") })).toEqual(["murder"]);
    expect(retriableCounts({ ...base, deliberation: verdict("hung", "guilty") })).toBeNull();
    expect(retriableCounts({ ...base, deliberation: verdict("not-guilty", "not-guilty") })).toBeNull();
    expect(retriableCounts({ ...base, deliberation: verdict("hung", "hung"), dismissedCounts: ["gang-enh"] })).toEqual(["murder"]);
  });
  it("starts a fresh trial on the hung count only, and acquittals never come back", () => {
    const prev = { ...initTrial(c, 1), deliberation: verdict("hung", "not-guilty") };
    const r = initRetrial(c, prev, 2);
    expect(r.phase).toBe("arraignment");
    expect(r.transcript).toEqual([]);
    expect(r.retrial).toMatchObject({ round: 2, acquitted: ["gang-enh"] });
    expect(r.retrial!.prior).toHaveLength(1);
    expect(activeCase(c, r).charges.map((x) => x.id)).toEqual(["murder"]);
    expect(activeCase(c, prev)).toBe(c);
    // A second hung jury on murder keeps the earlier acquittal and bumps the round.
    const again = initRetrial(c, { ...r, deliberation: { ...verdict("hung", "not-guilty"), verdicts: [verdict("hung", "hung").verdicts[0]] } }, 3);
    expect(again.retrial).toMatchObject({ round: 3, acquitted: ["gang-enh"] });
    expect(again.retrial!.prior.map((p) => p.round)).toEqual([1, 2]);
  });
  it("mock court and jury only see the live count", () => {
    const prev = { ...initTrial(c, 1), deliberation: verdict("hung", "not-guilty") };
    const r = initRetrial(c, prev, 2);
    const live = activeCase(c, r);
    const d = mockDeliberation(live, r);
    expect(d.verdicts.map((v) => v.chargeId)).toEqual(["murder"]);
    const arraign = mockTurn(live, r, { kind: "proceed" }).lines.map((l) => l.text).join(" ");
    expect(arraign).toContain("Murder");
    expect(arraign).not.toContain("Gang Enhancement");
  });
});

describe("retrial carries the first trial's record", () => {
  const played = () => {
    let s = initTrial(c, 1);
    s = reducer(s, { type: "advance" }); // pretrial marker
    s = reducer(s, { type: "turn", turn: blank({ ruling: { on: "Motion to suppress lyrics", result: "granted", reason: "403", favorsDefense: true }, evidenceExcluded: ["lyrics"] }) });
    while (s.phase !== "prosecution_case") s = reducer(s, { type: "advance" });
    s = reducer(s, { type: "callWitness", witnessId: "eyewitness", mode: "cross" });
    s = reducer(s, { type: "say", speaker: "defense", name: "Defense (You)", text: "Were you wearing your glasses?" });
    s = reducer(s, { type: "turn", turn: blank({
      lines: [{ speaker: "witness", name: "Ida Witness", text: "No. I had left them at home." }],
      factsRevealed: [{ witnessId: "eyewitness", fact: "She was wearing no glasses and it was dark under a broken streetlight" }],
    }) });
    while (s.phase !== "deliberation") s = reducer(s, { type: "advance" });
    return reducer(s, { type: "deliberated", result: { transcript: [], foreperson: "F", keyFactor: "The eyewitness", critique: ["Good cross"], verdicts: [
      { chargeId: "murder", result: "hung", lesser: null, votesNotGuilty: 7 },
      { chargeId: "gang-enh", result: "not-guilty", lesser: null, votesNotGuilty: 12 },
    ] } });
  };
  it("snapshots rulings, exposed facts, exclusions and phased testimony", () => {
    const p = priorTrialRecord(played());
    expect(p.round).toBe(1);
    expect(p.excluded).toEqual(["lyrics"]);
    expect(p.revealed[0].fact).toMatch(/no glasses/);
    expect(p.keyFactor).toBe("The eyewitness");
    const ida = p.transcript.find((l) => l.name === "Ida Witness")!;
    expect(ida.phase).toBe("prosecution_case");
    expect(p.transcript.some((l) => l.speaker === "system")).toBe(false);
  });
  it("feeds the record to the model on every retrial turn, but never on a first trial", () => {
    const prev = played();
    const r = initRetrial(c, prev, 2);
    const notes = priorTrialNotes(c, r);
    expect(notes).toContain("SWORN TESTIMONY OF IDA WITNESS");
    expect(notes).toContain("Q (Defense (You)): Were you wearing your glasses?");
    expect(notes).toContain("no glasses");
    expect(notes).toContain("Murder hung (7-5 NG)");
    const prompt = turnPrompt(activeCase(c, r), r, { kind: "proceed" });
    expect(prompt).toContain("RETRIAL (round 2)");
    expect(prompt).toContain("ACQUITTED of: Gang Enhancement");
    expect(prompt).toContain("PRIOR TRIAL RECORD");
    expect(turnPrompt(c, prev, { kind: "proceed" })).not.toContain("RETRIAL (round");
    expect(priorTrialNotes(c, prev)).toBe("");
  });
  it("keeps the prompt digest within budget on a long record", () => {
    const prev = played();
    const long = { ...prev, transcript: [...prev.transcript, ...Array.from({ length: 400 }, (_, i) => ({ id: 1000 + i, speaker: "witness" as const, name: "Ida Witness", text: `Answer number ${i} `.repeat(20) }))] };
    const r = initRetrial(c, long, 2);
    expect(priorTrialNotes(c, r, 4000).length).toBeLessThan(6000);
    expect(priorTrialNotes(c, r, 4000)).toContain("further testimony omitted");
  });
});

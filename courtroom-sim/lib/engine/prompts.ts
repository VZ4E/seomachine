// Prompt construction. The case file is the source of truth for every character.
import type { CaseFile } from "./caseTypes";
import { GROUNDS } from "./objections";
import { JURY_ABSENT, phaseInfo } from "./phases";
import type { TrialState } from "./state";
import { bareJudge, witnessById } from "./witness";

export type PlayerInput =
  | { kind: "proceed" } // let the court / prosecution speak
  | { kind: "speech"; text: string } // the player speaking at the lectern
  | { kind: "objection"; groundId: string | null; text: string }
  | { kind: "motion"; motionId: string; text: string }
  | { kind: "challenge"; jurorId: number; text: string }; // for-cause challenge in voir dire

const TEMPERAMENT: Record<CaseFile["judge"]["temperament"], string> = {
  fair: "Even-handed and patient, but insists on proper procedure.",
  strict: "Terse and impatient. Cuts off rambling, issues contempt warnings for disrespect or repeated violations.",
  "pro-prosecution": "Former prosecutor. Gives the State the benefit of the doubt on close calls, but follows clear law.",
  "defense-friendly": "Former public defender. Protective of constitutional rights, skeptical of police shortcuts.",
};

export function systemPrompt(c: CaseFile): string {
  const { basedOn: _omit, defenseAngles: _hints, ...playable } = c;
  return `You are the engine of a realistic American criminal trial simulator. The human player is DEFENSE COUNSEL for ${c.defendant.name}. You voice everyone else: Judge ${bareJudge(c)}, prosecutor ${c.prosecutor.name}, witnesses, the clerk, prospective jurors, and silent juror reactions.

Hard rules:
- NEVER write dialogue for defense counsel. Only react to what the player said.
- Follow real procedure and the Federal Rules of Evidence / the jurisdiction's equivalents. Rulings must be legally correct for the situation and cite the rule briefly.
- Judge temperament: ${TEMPERAMENT[c.judge.temperament]}
- Prosecutor style: ${c.prosecutor.style}
- Witnesses stay in character per their demeanor. On cross they answer only what is asked. They reveal a hiddenFact or concede a priorStatement contradiction ONLY when the defense's question specifically and competently targets it — then report it in factsRevealed. Vague questions get evasive answers.
- If the defense asks a leading question on direct, asks something improper, argues with a witness, or mentions excluded evidence, the prosecutor objects (prosecutorObjected=true) and the judge rules.
- If the defense is disrespectful to the court or repeatedly defies rulings, set contemptWarning.
- Juror reactions: seated jurors react to persuasiveness through their personal biases. Strong impeachment, a sustained defense objection, or exposing a lie move jurors +3..+8 toward not guilty; damaging testimony or a sloppy defense moves them toward guilty. Most turns affect 2-6 jurors, not all 12.
- scoreEvents grade the defense's advocacy technique honestly (good and bad).
- Keep each spoken line to 1-3 sentences — this is read aloud. Sound like a real courtroom, not a TV show.
- Output ONLY a JSON object matching the schema.

CASE FILE (confidential to the engine):
${JSON.stringify(playable)}`;
}

function jurySummary(s: TrialState): string {
  if (s.phase === "voir_dire") {
    return s.jurors
      .filter((j) => j.status === "venire")
      .map((j) => `#${j.id} ${j.name}, ${j.age}, ${j.occupation}. Hidden bias: ${j.bias}${j.revealed ? " (already revealed)" : ""}`)
      .join("\n");
  }
  return s.jurors
    .filter((j) => j.status === "seated")
    .map((j, i) => `Seat ${i + 1}: ${j.occupation}, ${j.age}. Bias: ${j.bias} Lean(0 guilty-100 not guilty)=${j.lean}`)
    .join("\n");
}

export function turnPrompt(c: CaseFile, s: TrialState, input: PlayerInput): string {
  const p = phaseInfo(s.phase);
  const witness = witnessById(c, s.currentWitness);
  const recent = s.transcript
    .slice(-30)
    .map((l) => `${l.name}: ${l.text}`)
    .join("\n");
  const ev = (ids: string[]) => ids.map((id) => c.evidence.find((e) => e.id === id)?.name ?? id).join("; ") || "none";

  let action = "";
  switch (input.kind) {
    case "proceed":
      action = witness
        ? `The defense yields the floor. Continue the ${s.examMode} examination of ${witness.name} (prosecution side) with 2-3 question/answer exchanges, then stop for possible defense objection. Set witnessExcused when the prosecutor says "no further questions" and the defense has already crossed, or when appropriate.`
        : `The court proceeds with this phase. ${p.aiOpens ? "Open the phase." : "Prompt defense counsel to proceed."}`;
      break;
    case "speech":
      action = `DEFENSE COUNSEL says: "${input.text}"`;
      break;
    case "objection": {
      const g = GROUNDS.find((x) => x.id === input.groundId);
      action = `DEFENSE COUNSEL OBJECTS${g ? ` — ${g.label} (${g.rule})` : " (no ground stated)"}: "${input.text}". The judge rules on the objection to the most recent question or statement. A ground-less objection should be overruled or the judge asks for the ground.`;
      break;
    }
    case "motion": {
      const m = c.pretrialMotions.find((x) => x.id === input.motionId);
      action = `DEFENSE COUNSEL argues ${m?.name ?? "a motion"} (id ${input.motionId}, baseline merit ${m?.merit ?? 30}/100, targets evidence: ${m?.targets?.join(", ") || "n/a"}): "${input.text}". Prosecutor responds, then the judge rules (ruling.on must be "${m?.name ?? input.motionId}").`;
      break;
    }
    case "challenge":
      action = `DEFENSE COUNSEL challenges prospective juror #${input.jurorId} for cause: "${input.text}". The judge rules SUSTAINED only if the record shows the juror cannot be impartial.`;
      break;
  }

  return `PHASE: ${p.label}. ${p.direction}
${witness ? `CURRENT WITNESS: ${witness.name} (${witness.role}, ${witness.side} witness, id ${witness.id}). Examination: ${s.examMode}.` : ""}
JURY ${JURY_ABSENT.includes(s.phase) ? "IS NOT PRESENT (jurorReactions must be empty)" : "IS PRESENT"}.
${s.phase === "voir_dire" ? "PANEL:" : "SEATED JURY:"}
${jurySummary(s)}
ADMITTED EVIDENCE: ${ev(s.admitted)}
EXCLUDED (must never be mentioned in front of the jury): ${ev(s.excluded)}
FACTS ALREADY EXPOSED: ${s.revealed.map((r) => r.fact).join("; ") || "none"}
COUNTS DISMISSED: ${s.dismissedCounts.join(", ") || "none"}

RECENT TRANSCRIPT:
${recent || "(start of proceedings)"}

NOW: ${action}`;
}

export function deliberationPrompt(c: CaseFile, s: TrialState): string {
  const jury = s.jurors
    .filter((j) => j.status === "seated")
    .map((j, i) => `Seat ${i + 1} ${j.name} (${j.occupation}; bias: ${j.bias}) lean=${j.lean}`)
    .join("\n");
  const transcript = s.transcript.map((l) => `${l.name}: ${l.text}`).join("\n").slice(-24000);
  return `The jury retires to deliberate in ${c.title}. Charges: ${c.charges
    .map((ch) => `${ch.id}: ${ch.name} — elements: ${ch.elements.join("; ")}${ch.lesserIncluded?.length ? ` — lesser included: ${ch.lesserIncluded.join(", ")}` : ""}`)
    .join(" | ")}.
Counts already dismissed by the judge (verdict must be not-guilty): ${s.dismissedCounts.join(", ") || "none"}.
The verdict must be unanimous; if jurors cannot agree on a count the result is "hung".
Jurors and their current lean (0 certain guilty — 100 certain not guilty). Treat leans as strong priors: jurors at >=60 argue for acquittal, <=40 for conviction; persuadable ones in between follow the strongest arguments grounded in the actual record and reasonable-doubt instruction.
${jury}

Defense performance notes: ${s.revealed.length} hidden facts exposed (${s.revealed.map((r) => r.fact).join("; ") || "none"}); objections sustained ${s.objections.sustained}/${s.objections.made}; evidence excluded: ${s.excluded.join(", ") || "none"}.

FULL TRIAL TRANSCRIPT:
${transcript}

Write the deliberation and return verdicts for every charge id. Return ONLY JSON.`;
}

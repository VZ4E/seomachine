import { NextResponse } from "next/server";
import { getCase } from "@/lib/cases";
import { callModel, hasKey } from "@/lib/ai/openrouter";
import { mockDeliberation } from "@/lib/ai/mock";
import { deliberationPrompt, systemPrompt } from "@/lib/engine/prompts";
import { Deliberation } from "@/lib/engine/schema";
import type { TrialState } from "@/lib/engine/state";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { caseId, state } = (await req.json()) as { caseId: string; state: TrialState };
  const c = getCase(caseId);
  if (!c || !state) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const finalize = (d: Deliberation) => ({
    ...d,
    // Every charge gets a verdict, and judge-dismissed counts are always acquittals.
    verdicts: c.charges.map((ch) => {
      const v = d.verdicts.find((x) => x.chargeId === ch.id);
      if (state.dismissedCounts.includes(ch.id)) return { chargeId: ch.id, result: "not-guilty" as const, lesser: null, votesNotGuilty: 12 };
      return v ?? { chargeId: ch.id, result: "hung" as const, lesser: null, votesNotGuilty: 6 };
    }),
  });

  if (!hasKey()) return NextResponse.json({ result: finalize(mockDeliberation(c, state)), model: "offline-mock" });
  try {
    const r = await callModel({
      schema: Deliberation,
      schemaName: "deliberation",
      system: systemPrompt(c),
      user: deliberationPrompt(c, state),
      temperature: 0.7,
      maxTokens: 3000,
    });
    return NextResponse.json({ result: finalize(r.data), model: r.model });
  } catch (e) {
    console.error("deliberation failed", e);
    return NextResponse.json({ result: finalize(mockDeliberation(c, state)), model: "offline-mock", warning: "AI unavailable; verdict computed from juror leans." });
  }
}

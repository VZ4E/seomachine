import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "@/lib/ai/openrouter";
import { CourtTurn } from "@/lib/engine/schema";

const valid = {
  lines: [{ speaker: "judge", name: "Judge X", text: "Overruled." }],
  ruling: { on: "Hearsay", result: "overruled", reason: "Not offered for truth.", favorsDefense: false },
  prosecutorObjected: false, evidenceAdmitted: [], evidenceExcluded: [], factsRevealed: [], jurorReactions: [],
  scoreEvents: [], jurorsRevealed: [], contemptWarning: false, witnessExcused: false, countsDismissed: [],
};
const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

const opts = { schema: CourtTurn, schemaName: "court_turn", system: "s", user: "u" };

describe("callModel", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test";
    process.env.COURT_MODEL_FAST = "fast/model";
    process.env.COURT_MODEL_LIGHT = "light/model";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns typed data from the fast model and requests a JSON schema", async () => {
    const fetch = vi.fn().mockResolvedValue(reply("```json\n" + JSON.stringify(valid) + "\n```"));
    vi.stubGlobal("fetch", fetch);
    const r = await callModel(opts);
    expect(r).toMatchObject({ model: "fast/model", fellBack: false });
    expect(r.data.lines[0].text).toBe("Overruled.");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe("fast/model");
    expect(body.response_format.type).toBe("json_schema");
  });

  it("falls back to the lightweight model on HTTP error or schema mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply("", 503)).mockResolvedValueOnce(reply(JSON.stringify(valid))));
    expect(await callModel(opts)).toMatchObject({ model: "light/model", fellBack: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(JSON.stringify({ lines: "nope" }))).mockResolvedValueOnce(reply(JSON.stringify(valid))));
    expect(await callModel(opts)).toMatchObject({ model: "light/model", fellBack: true });
  });

  it("prefers the light model when asked, and throws when both fail", async () => {
    const fetch = vi.fn().mockImplementation(async () => reply(JSON.stringify(valid)));
    vi.stubGlobal("fetch", fetch);
    await callModel({ ...opts, prefer: "light" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("light/model");

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply("", 500)));
    await expect(callModel(opts)).rejects.toThrow(/fast\/model.*light\/model/);
  });
});

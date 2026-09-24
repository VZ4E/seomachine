// OpenRouter client with a fast primary model and a lightweight fallback.
// Output is forced to JSON (json_schema response_format) and validated with zod,
// so callers always get a typed value or an error — never free text.
import { z } from "zod";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export type Tier = "fast" | "light";

export const models = () => ({
  fast: process.env.COURT_MODEL_FAST || "google/gemini-2.5-flash",
  light: process.env.COURT_MODEL_LIGHT || "meta-llama/llama-3.1-8b-instruct",
});

export const hasKey = () => Boolean(process.env.OPENROUTER_API_KEY);

interface CallOpts<T extends z.ZodType> {
  schema: T;
  schemaName: string;
  system: string;
  user: string;
  /** Which model to try first. The other one is the fallback. */
  prefer?: Tier;
  temperature?: number;
  maxTokens?: number;
}

export interface CallResult<T> {
  data: T;
  model: string;
  fellBack: boolean;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
}

async function callOnce<T extends z.ZodType>(model: string, o: CallOpts<T>, timeoutMs: number): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(o.schema, { target: "draft-7" });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Defense Counsel Courtroom Sim",
    },
    body: JSON.stringify({
      model,
      temperature: o.temperature ?? 0.8,
      max_tokens: o.maxTokens ?? 1800,
      response_format: { type: "json_schema", json_schema: { name: o.schemaName, strict: false, schema: jsonSchema } },
      messages: [
        { role: "system", content: `${o.system}\n\nRespond with JSON matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: o.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${model}: empty response`);
  const parsed = o.schema.safeParse(extractJson(content));
  if (!parsed.success) throw new Error(`${model}: schema mismatch — ${parsed.error.message.slice(0, 300)}`);
  return parsed.data;
}

export async function callModel<T extends z.ZodType>(o: CallOpts<T>): Promise<CallResult<z.infer<T>>> {
  const m = models();
  const order: Tier[] = o.prefer === "light" ? ["light", "fast"] : ["fast", "light"];
  const timeout = Number(process.env.COURT_MODEL_TIMEOUT_MS) || 15000;
  const errors: string[] = [];
  for (const [i, tier] of order.entries()) {
    try {
      // The fallback gets extra time: it's the last chance before the turn fails.
      const data = await callOnce(m[tier], o, i === 0 ? timeout : timeout * 2);
      return { data, model: m[tier], fellBack: i > 0 };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(" | "));
}

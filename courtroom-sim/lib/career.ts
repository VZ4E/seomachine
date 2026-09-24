"use client";
import type { Outcome } from "./engine/scoring";
import type { TrialState } from "./engine/state";

export interface CaseRecord { grade: string; outcome: Outcome; points: number; date: string }
export interface Career {
  points: number;
  wins: number;
  losses: number;
  hung: number;
  practice: boolean;
  cases: Record<string, CaseRecord>;
}

const KEY = "defense-counsel:career";
const TRIAL_KEY = (id: string) => `defense-counsel:trial:${id}`;
export const EMPTY: Career = { points: 0, wins: 0, losses: 0, hung: 0, practice: false, cases: {} };

export function loadCareer(): Career {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return EMPTY; }
}
export function saveCareer(c: Career) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

export function recordTrial(caseId: string, outcome: Outcome, points: number, grade: string): Career {
  const c = loadCareer();
  const prev = c.cases[caseId];
  // Replays only add the improvement over your best score on that case.
  const gained = Math.max(0, points - (prev?.points ?? 0));
  const next: Career = {
    ...c,
    points: c.points + gained,
    wins: c.wins + (outcome === "acquittal" ? 1 : 0),
    hung: c.hung + (outcome === "hung" || outcome === "partial" ? 1 : 0),
    losses: c.losses + (outcome === "conviction" ? 1 : 0),
    cases: { ...c.cases, [caseId]: !prev || points > prev.points ? { grade, outcome, points, date: new Date().toISOString() } : prev },
  };
  saveCareer(next);
  return next;
}

export function saveTrial(s: TrialState) {
  try { localStorage.setItem(TRIAL_KEY(s.caseId), JSON.stringify(s)); } catch { /* ignore */ }
}
export function loadTrial(id: string): TrialState | null {
  try { const raw = localStorage.getItem(TRIAL_KEY(id)); return raw ? (JSON.parse(raw) as TrialState) : null; } catch { return null; }
}
export function clearTrial(id: string) {
  try { localStorage.removeItem(TRIAL_KEY(id)); } catch { /* ignore */ }
}

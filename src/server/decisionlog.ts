// ============================================================================
// decisionlog.ts — append-only audit log of every autopilot decision (and every
// defer/abort/shadow). Persists to JSONL so the user can review later; keeps a
// bounded in-memory ring for the UI and tracks cumulative cost for "today".
// ============================================================================

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AutopilotDecision } from '../shared/contract';

const RING_MAX = 500;
const FILE_MAX_BYTES = 5 * 1024 * 1024; // rotate the JSONL past this (bounds disk to ~2×)
const CHECK_EVERY = 100; // how often (in writes) to stat the file for rotation

export class DecisionLog {
  private ring: AutopilotDecision[] = [];
  private costToday = 0;
  private todayKey = new Date().toISOString().slice(0, 10);
  private writesSinceCheck = 0;

  constructor(private readonly jsonlPath: string) {}

  /** Rotate the JSONL to `<path>.1` (overwriting any prior archive) when it
   *  exceeds FILE_MAX_BYTES — so an always-on daemon can't grow it without bound.
   *  The in-memory ring keeps serving the UI; the rotated file is the archive. */
  private async maybeRotate(): Promise<void> {
    if (++this.writesSinceCheck < CHECK_EVERY) return;
    this.writesSinceCheck = 0;
    try {
      const st = await stat(this.jsonlPath);
      if (st.size > FILE_MAX_BYTES) await rename(this.jsonlPath, this.jsonlPath + '.1');
    } catch {
      /* stat/rename best-effort — never crash the engine over log housekeeping */
    }
  }

  getRecent(): AutopilotDecision[] {
    return this.ring;
  }

  /** Precedents: how questions like this got answered before — manual answers
   *  (the human's own choices, the strongest signal) and past sent decisions.
   *  Same-cwd history first, then anything else, newest first. This is what
   *  lets the brain answer the way YOU would, not the way a generic LLM would. */
  precedents(cwd: string | undefined, limit: number): { question: string; answer: string; byHuman: boolean }[] {
    const pick = (d: AutopilotDecision) =>
      (d.outcome === 'manual_answer' || d.outcome === 'sent') && !!d.question;
    const toEntry = (d: AutopilotDecision) => ({
      question: d.question.slice(0, 200),
      answer: (d.outcome === 'manual_answer'
        ? (d.actionSent || '').replace(/^human:/, '')
        : d.decision?.payload ||
          d.options.find((o) => o.index === d.decision?.optionIndex)?.label ||
          d.actionSent ||
          ''
      ).slice(0, 200),
      byHuman: d.outcome === 'manual_answer',
    });
    const same = this.ring.filter((d) => pick(d) && cwd && d.cwd === cwd);
    const rest = this.ring.filter((d) => pick(d) && !(cwd && d.cwd === cwd));
    return [...same, ...rest].slice(0, limit).map(toEntry).filter((e) => e.answer);
  }

  getCostToday(): number {
    return this.costToday;
  }

  async record(d: AutopilotDecision): Promise<void> {
    this.ring.unshift(d);
    if (this.ring.length > RING_MAX) this.ring.length = RING_MAX;

    const day = new Date(d.ts).toISOString().slice(0, 10);
    if (day !== this.todayKey) {
      this.todayKey = day;
      this.costToday = 0;
    }
    if (typeof d.costUsd === 'number') this.costToday += d.costUsd;

    try {
      await mkdir(dirname(this.jsonlPath), { recursive: true });
      await appendFile(this.jsonlPath, JSON.stringify(d) + '\n', 'utf8');
      await this.maybeRotate();
    } catch {
      /* logging must never crash the engine */
    }
  }
}

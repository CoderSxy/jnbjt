import type { Pool } from 'pg';
import type { Job, JobInput, JobResult } from '@jnbjt/contracts';
import { claimNextJob, completeJob, renewLease } from './repository.js';

export type JobHandler = (job: Job, signal: AbortSignal) => Promise<JobResult>;

const handlers = new Map<JobInput['kind'], JobHandler>();

export function registerJobHandler(kind: JobInput['kind'], handler: JobHandler): void {
  handlers.set(kind, handler);
}

export async function runJob(job: Job, signal: AbortSignal): Promise<JobResult> {
  const handler = handlers.get(job.kind);
  if (!handler) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_KIND', message: `no handler for ${job.kind}` },
    };
  }
  return handler(job, signal);
}

export type JobRunnerOptions = {
  pool: Pool;
  workerId: string;
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
};

export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private active: AbortController | null = null;
  private renewTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: JobRunnerOptions) {}

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.active?.abort();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.opts.pollIntervalMs ?? 200);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const job = await claimNextJob(this.opts.pool, this.opts.workerId);
      if (!job) {
        this.schedule();
        return;
      }
      this.active = new AbortController();
      this.renewTimer = setInterval(() => {
        void renewLease(this.opts.pool, job.id, this.opts.workerId);
      }, 5_000);

      let result: JobResult;
      try {
        result = await runJob(job, this.active.signal);
      } catch (error) {
        result = {
          ok: false,
          error: {
            code: 'HANDLER_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      } finally {
        if (this.renewTimer) clearInterval(this.renewTimer);
        this.renewTimer = null;
      }

      await completeJob(this.opts.pool, job.id, this.opts.workerId, result);
    } catch (error) {
      this.opts.onError?.(error);
    } finally {
      this.active = null;
      this.schedule();
    }
  }
}

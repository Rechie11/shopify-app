import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '@ember-and-ash/db/client';
import { jobs } from '@ember-and-ash/db';
import type { FastifyBaseLogger } from 'fastify';
import { isMysqlErrorCode } from '../db/errors.js';

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (db: Db, job: JobRow) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

// FOR UPDATE SKIP LOCKED gives safe multi-worker claiming without a second
// piece of infrastructure. See ARCHITECTURE.md §7.
async function claimJobs(db: Db, limit: number): Promise<JobRow[]> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, new Date())))
      .orderBy(jobs.runAt)
      .limit(limit)
      .for('update', { skipLocked: true });

    if (claimed.length === 0) {
      return [];
    }

    const ids = claimed.map((job) => job.id);
    await tx
      .update(jobs)
      .set({ status: 'running', lockedAt: new Date(), lockedBy: workerId })
      .where(inArray(jobs.id, ids));

    return claimed;
  });
}

function backoffMinutes(attempts: number): number {
  return 2 ** attempts;
}

async function processJob(db: Db, job: JobRow, log: FastifyBaseLogger): Promise<void> {
  const handler = handlers.get(job.type);
  if (!handler) {
    log.error({ jobId: job.id, type: job.type }, 'no handler registered for job type');
    await db
      .update(jobs)
      .set({ status: 'dead', lastError: `no handler registered for type "${job.type}"` })
      .where(eq(jobs.id, job.id));
    return;
  }

  try {
    await handler(db, job);
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id));
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    log.error({ jobId: job.id, type: job.type, attempts, err }, 'job failed');

    if (attempts >= job.maxAttempts) {
      await db
        .update(jobs)
        .set({ status: 'dead', attempts, lastError: message })
        .where(eq(jobs.id, job.id));
      return;
    }

    const runAt = new Date(Date.now() + backoffMinutes(attempts) * 60_000);
    try {
      await db
        .update(jobs)
        .set({ status: 'pending', attempts, lastError: message, runAt })
        .where(eq(jobs.id, job.id));
    } catch (updateErr) {
      // A fresher job with the same coalesce key was enqueued while this
      // one was running (its pending_key was NULL mid-flight, so the
      // insert didn't collide then). That job will do the work; this row
      // is superseded rather than a real failure.
      if (isMysqlErrorCode(updateErr, 'ER_DUP_ENTRY')) {
        await db
          .update(jobs)
          .set({ status: 'failed', attempts, lastError: `${message} (superseded by a newer job)` })
          .where(eq(jobs.id, job.id));
        return;
      }
      throw updateErr;
    }
  }
}

export interface WorkerLoopOptions {
  db: Db;
  log: FastifyBaseLogger;
  pollIntervalMs?: number;
  batchSize?: number;
}

export function startWorkerLoop(opts: WorkerLoopOptions): { stop: () => void } {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const batchSize = opts.batchSize ?? 10;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const claimed = await claimJobs(opts.db, batchSize);
      await Promise.all(claimed.map((job) => processJob(opts.db, job, opts.log)));
    } catch (err) {
      opts.log.error({ err }, 'worker loop tick failed');
    }
    if (!stopped) {
      setTimeout(() => void tick(), pollIntervalMs);
    }
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

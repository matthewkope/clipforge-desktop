import type { PinterestRateLimitState } from '../../shared/media.js';
import { logPinterestDebug } from '../utils/pinterestDebug.js';

const state: PinterestRateLimitState = {
  consecutive429Count: 0,
  activePinterestJob: false,
  pendingPinterestJobs: 0,
  paused: false
};

export function isPinterestRateLimitedOutput(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes('429') ||
    normalized.includes('too many requests') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate limiting') ||
    normalized.includes('platform is rate limiting')
  );
}

export async function markPinterest429(details?: unknown): Promise<void> {
  state.consecutive429Count += 1;
  state.last429At = new Date().toISOString();
  const pauseMs = Math.min(300_000, 60_000 * 2 ** Math.max(0, state.consecutive429Count - 1));
  state.pausedUntil = new Date(Date.now() + pauseMs).toISOString();
  state.paused = true;
  await logPinterestDebug('rate-limit:429', { ...state, details });
}

export async function resumePinterestQueueState(): Promise<PinterestRateLimitState> {
  state.paused = false;
  state.pausedUntil = undefined;
  state.consecutive429Count = 0;
  await logPinterestDebug('rate-limit:resume', state);
  return getPinterestRateLimitState();
}

export function getPinterestRateLimitState(): PinterestRateLimitState {
  if (state.pausedUntil && Date.now() >= new Date(state.pausedUntil).getTime()) {
    state.paused = false;
    state.pausedUntil = undefined;
  }
  return { ...state };
}

export function setPinterestActive(active: boolean): void {
  state.activePinterestJob = active;
}

export function setPinterestPending(count: number): void {
  state.pendingPinterestJobs = count;
}

export function pinterestRateLimitMessage(): string {
  return 'Pinterest is temporarily rate limiting this download. This usually happens when too many board items are requested too quickly. The app paused the queue to avoid making it worse. Try again later, or enable Brave cookies in Settings.';
}

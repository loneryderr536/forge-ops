import type { TurnResult } from '../types';

export function classifyError(message: string): 'auth' | 'network' | 'transient' | 'other' {
  if (/401|403|invalid.*key|unauthori[sz]ed|api key/i.test(message)) {
    return 'auth';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|unreachable|no response from model/i.test(message)) {
    return 'network';
  }
  if (/429|5\d\d|timeout|overloaded|rate limit/i.test(message)) {
    return 'transient';
  }
  return 'other';
}

export function isRateLimit(message: string): boolean {
  return /429|rate.?limit|too many requests|tokens per minute|quota/i.test(message);
}

/** Parse "try again in 1m2.5s" / "retry after 12s" / "retry-after: 8"; fall back to backoff. */
export function rateLimitWaitMs(message: string, attemptIndex: number): number {
  const m = message.match(/(?:try again|retry)[^0-9]{0,15}(?:(\d+)\s*m(?!s))?\s*(\d+(?:\.\d+)?)\s*(ms|s)?/i);
  let ms = 0;
  if (m) {
    const mins = m[1] ? Number(m[1]) : 0;
    const val = Number(m[2]);
    ms = mins * 60000 + (m[3] === 'ms' ? val : val * 1000);
  }
  if (!ms) ms = [5000, 15000, 30000][Math.min(attemptIndex, 2)];
  return Math.min(Math.max(ms + 500, 1000), 60000);
}

export const MAX_RATE_LIMIT_RETRIES = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runWithFallback(
  models: string[],
  attempt: (model: string) => Promise<TurnResult>,
  notify: (text: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<TurnResult & { model: string }> {
  if (models.length === 0) {
    return {
      status: 'error',
      message: 'No models configured',
      sessionId: '',
      model: '',
    };
  }

  let lastResult: TurnResult = {
    status: 'error',
    message: 'Unknown error',
    sessionId: '',
  };
  let lastModel = models[0];

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    lastModel = currentModel;

    let res = await attempt(currentModel);
    if (res.status === 'completed' || res.status === 'cancelled') {
      return { ...res, model: currentModel };
    }

    // It's an error
    const errClass = classifyError(res.message || '');
    if (errClass === 'transient' && isRateLimit(res.message || '')) {
      // Rate limited: wait out the window and retry the same model (up to 3 times).
      for (let r = 0; r < MAX_RATE_LIMIT_RETRIES; r++) {
        const wait = rateLimitWaitMs(res.message || '', r);
        notify(`${currentModel} is rate limited. Waiting ${Math.round(wait / 1000)}s, then retrying (${r + 1}/${MAX_RATE_LIMIT_RETRIES}).`);
        await sleep(wait);
        res = await attempt(currentModel);
        if (res.status === 'completed' || res.status === 'cancelled') {
          return { ...res, model: currentModel };
        }
        if (!isRateLimit(res.message || '')) break;
      }
    } else if (errClass === 'transient') {
      // Retry once after 1.5s
      await sleep(1500);
      res = await attempt(currentModel);
      if (res.status === 'completed' || res.status === 'cancelled') {
        return { ...res, model: currentModel };
      }
    }

    lastResult = res;

    // Check if there is a fallback model
    if (i + 1 < models.length) {
      const nextModel = models[i + 1];
      notify(`${currentModel} failed (${res.message || 'error'}). Switched to fallback ${nextModel}.`);
    }
  }

  return { ...lastResult, model: lastModel };
}

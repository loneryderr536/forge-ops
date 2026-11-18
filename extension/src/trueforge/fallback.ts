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

/** Parse "try again in 1m2.5s" / "retry in 10h52m" / "retry after 12s" into ms; 0 if no hint. */
export function parseRetryHintMs(message: string): number {
  const m = message.match(/(?:try again|retry)[\s-]*(?:in|after)?[\s:]*((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+|\d+(?:\.\d+)?)/i);
  if (!m) return 0;
  const units: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1 };
  let ms = 0;
  let matched = false;
  for (const t of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) {
    matched = true;
    ms += Number(t[1]) * units[t[2].toLowerCase()];
  }
  return matched ? ms : Number(m[1]) * 1000;
}

/** Wait before retry: the server hint if given, else 5s/15s/30s backoff; capped at 60s. */
export function rateLimitWaitMs(message: string, attemptIndex: number): number {
  const hint = parseRetryHintMs(message);
  const ms = hint || [5000, 15000, 30000][Math.min(attemptIndex, 2)];
  return Math.min(Math.max(ms + 500, 1000), 60000);
}

/** Model called a tool that does not exist (e.g. 'runME'); usually a one-off slip, so retry. */
export function isToolHallucination(message: string): boolean {
  return /tool call validation failed|not in request\.tools|unknown tool|tool .* not found/i.test(message);
}

export const MAX_TOOL_GUARD_RETRIES = 2;
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
    // A hint over a minute means a daily/long quota: waiting is pointless, so fall back at once.
    const longQuota = parseRetryHintMs(res.message || '') > 60000;
    if (isToolHallucination(res.message || '')) {
      for (let r = 0; r < MAX_TOOL_GUARD_RETRIES; r++) {
        notify(`${currentModel} called an unknown tool. Retrying (${r + 1}/${MAX_TOOL_GUARD_RETRIES}).`);
        await sleep(500);
        res = await attempt(currentModel);
        if (res.status === 'completed' || res.status === 'cancelled') {
          return { ...res, model: currentModel };
        }
        if (!isToolHallucination(res.message || '')) break;
      }
    } else if (isRateLimit(res.message || '') && !longQuota && errClass !== 'network') {
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
    } else if (errClass === 'transient' && !longQuota) {
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

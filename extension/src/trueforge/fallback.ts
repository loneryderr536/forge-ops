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
    if (errClass === 'transient') {
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

import type { ApprovalRequest, TurnHandlers, TurnResult } from '../types';
import { routeEvent } from './router';

export type AgentRef = { name: string } | { spec: unknown };

export class ForgeClient {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:8790') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async startSession(agent: AgentRef): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create session (${res.status}): ${errText}`);
    }

    const body = await res.json() as any;
    const data = body?.data ?? body;
    const id = data?.id || data?.session_id || data?.sessionId;
    if (!id) throw new Error(`TrueForge session response had no id: ${JSON.stringify(body).slice(0, 200)}`);
    return id;
  }

  async runTurn(
    sessionId: string,
    input: string,
    h: TurnHandlers,
    firstEventTimeoutMs = 20000,
    externalSignal?: AbortSignal
  ): Promise<TurnResult> {
    const eventIndex = new Map<string, any>();
    const state = { turnId: '', lastEventId: '' };

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    let firstEventReceived = false;
    let timedOut = false;

    const timeoutTimer = setTimeout(() => {
      if (!firstEventReceived) {
        timedOut = true;
        controller.abort();
      }
    }, firstEventTimeoutMs);

    try {
      let res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ input: [{ type: 'user.message', content: input }], stream: true }),
        signal: controller.signal,
      });

      // After a tool approval the server pauses the turn and the stream can close.
      // Re-subscribe from the last event until the turn reaches a terminal event.
      for (let resumes = 0; resumes < 200; resumes++) {
        if (!res.ok) {
          return { status: 'error', message: `HTTP ${res.status}: ${await res.text()}`, sessionId };
        }
        if (!res.body) {
          return { status: 'error', message: 'Empty response body from TrueForge', sessionId };
        }

        const before = state.lastEventId;
        const outcome = await this.consumeStream(res.body, sessionId, eventIndex, state, h, () => {
          firstEventReceived = true;
          clearTimeout(timeoutTimer);
        });
        if (outcome) return outcome;

        // Stream ended with no terminal event. If nothing new arrived, stop.
        if (resumes > 0 && state.lastEventId === before) {
          return { status: 'completed', sessionId };
        }
        if (!state.turnId) return { status: 'completed', sessionId };

        const q = state.lastEventId ? `?after_event_id=${encodeURIComponent(state.lastEventId)}` : '';
        res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns/${state.turnId}/subscribe${q}`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
      }
      return { status: 'error', message: 'Turn did not finish (too many stream resumes)', sessionId };
    } catch (err: any) {
      if (externalSignal?.aborted) {
        return { status: 'cancelled', sessionId };
      }
      if (timedOut) {
        return { status: 'error', message: 'no response from model within 20s', sessionId };
      }
      return { status: 'error', message: err.message || 'Stream connection error', sessionId };
    } finally {
      clearTimeout(timeoutTimer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    sessionId: string,
    eventIndex: Map<string, any>,
    state: { turnId: string; lastEventId: string },
    h: TurnHandlers,
    onFirstEvent: () => void
  ): Promise<TurnResult | undefined> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) return undefined;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        for (const line of block.trim().split('\n')) {
          if (!line.startsWith('data:')) continue;
          onFirstEvent();

          const rawJson = line.slice(5).trim();
          if (rawJson === '[DONE]') return { status: 'completed', sessionId };

          let ev: any;
          try {
            ev = JSON.parse(rawJson);
          } catch {
            continue; // malformed chunk
          }

          state.turnId = ev.turn_id || ev.turnId || ev.turn?.id || state.turnId;
          if (ev.id) state.lastEventId = ev.id;

          const routed = routeEvent(eventIndex, ev, h);

          for (const req of routed.approvals ?? []) {
            let decision: { status: 'allow' | 'deny'; reason?: string };
            try {
              decision = await h.onApproval(req);
            } catch (err: any) {
              console.error('Groundwork approval handler failed:', err);
              decision = { status: 'deny', reason: `approval handler error: ${err?.message ?? err}` };
            }
            await this.sendApprovalDecision(sessionId, state.turnId, req, decision);
          }

          if (routed.done) {
            return { status: routed.done.status, message: routed.done.message, sessionId };
          }
        }
      }
    }
  }

  private async sendApprovalDecision(
    sessionId: string,
    turnId: string,
    req: ApprovalRequest,
    decision: { status: 'allow' | 'deny'; reason?: string }
  ): Promise<void> {
    const payload = {
      events: [
        {
          type: 'user.tool_approval',
          thread_id: req.threadId,
          tool_call_id: req.toolCallId,
          approval: {
            status: decision.status,
            reason: decision.status === 'deny' ? decision.reason : undefined,
          },
        },
      ],
    };

    try {
      await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns/${turnId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Failed to send approval event:', err);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/cancel`, {
        method: 'POST',
      });
    } catch (err) {
      console.warn('Failed to cancel session:', err);
    }
  }
}

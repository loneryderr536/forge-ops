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

    const data = await res.json() as any;
    return data.id || data.session_id || data.sessionId;
  }

  async runTurn(
    sessionId: string,
    input: string,
    h: TurnHandlers,
    firstEventTimeoutMs = 20000
  ): Promise<TurnResult> {
    const eventIndex = new Map<string, any>();
    let turnId = '';
    let lastEventId = '';

    const controller = new AbortController();
    let firstEventReceived = false;

    const timeoutTimer = setTimeout(() => {
      if (!firstEventReceived) {
        controller.abort();
      }
    }, firstEventTimeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/turns/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          input: [{ type: 'user.message', content: input }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        clearTimeout(timeoutTimer);
        const errText = await res.text();
        return {
          status: 'error',
          message: `HTTP ${res.status}: ${errText}`,
          sessionId,
        };
      }

      if (!res.body) {
        clearTimeout(timeoutTimer);
        return {
          status: 'error',
          message: 'Empty response body from TrueForge',
          sessionId,
        };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;

          for (const line of trimmed.split('\n')) {
            if (line.startsWith('data:')) {
              firstEventReceived = true;
              clearTimeout(timeoutTimer);

              const rawJson = line.slice(5).trim();
              if (rawJson === '[DONE]') {
                return { status: 'completed', sessionId };
              }

              try {
                const ev = JSON.parse(rawJson);
                if (ev.turn_id || ev.turnId) {
                  turnId = ev.turn_id || ev.turnId;
                }
                if (ev.id) {
                  lastEventId = ev.id;
                }

                const routed = routeEvent(eventIndex, ev, h);

                if (routed.approvals && routed.approvals.length > 0) {
                  for (const req of routed.approvals) {
                    const decision = await h.onApproval(req);
                    await this.sendApprovalDecision(sessionId, turnId, req, decision);
                  }
                }

                if (routed.done) {
                  return {
                    status: routed.done.status,
                    message: routed.done.message,
                    sessionId,
                  };
                }
              } catch (parseErr) {
                // Ignore parse errors on malformed chunks
              }
            }
          }
        }
      }

      return { status: 'completed', sessionId };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (controller.signal.aborted) {
        return {
          status: 'error',
          message: 'no response from model within 20s',
          sessionId,
        };
      }
      return {
        status: 'error',
        message: err.message || 'Stream connection error',
        sessionId,
      };
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
          threadId: req.threadId,
          toolCallId: req.toolCallId,
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

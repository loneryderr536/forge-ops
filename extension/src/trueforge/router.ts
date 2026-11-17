import type { ApprovalRequest, TurnHandlers, TurnResult } from '../types';

export function routeEvent(
  index: Map<string, any>,
  ev: any,
  h: TurnHandlers
): { approvals?: ApprovalRequest[]; done?: Omit<TurnResult, 'sessionId'> } {
  if (ev.id) {
    index.set(ev.id, ev);
  }

  const type = ev.type || '';

  // 1. Streaming text deltas
  if (type === 'model.message.delta') {
    const delta = ev.delta?.content || ev.content || ev.delta?.text || ev.text || '';
    if (delta) {
      h.onText(delta);
    }
  }

  // 2. Full model message (may contain text or tool calls)
  if (type === 'model.message') {
    if (ev.content && typeof ev.content === 'string') {
      // Some providers send non-streamed content here
    }
    const toolCalls = ev.tool_calls || ev.message?.tool_calls || [];
    const threadId = ev.thread_id || ev.threadId || 'root';
    for (const call of toolCalls) {
      const name = call.function?.name || call.name || '';
      let args = call.function?.arguments || call.args || {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          // keep as string
        }
      }
      h.onToolCall(name, args, threadId);
    }
  }

  // 3. Tool response
  if (type === 'tool.response') {
    const name = ev.tool_name || ev.name || 'tool';
    const threadId = ev.thread_id || ev.threadId || 'root';
    const content = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content || {});
    const summary = content.length > 120 ? content.slice(0, 117) + '...' : content;
    h.onToolResult(name, summary, threadId);
  }

  // 4. Subagent threads
  if (type === 'thread.created') {
    const threadId = ev.thread_id || ev.id || '';
    h.onThread('created', threadId, ev.status);
  }
  if (type === 'thread.done') {
    const threadId = ev.thread_id || ev.id || '';
    h.onThread('done', threadId, ev.status || ev.state?.status);
  }

  // 5. Tool approvals required
  if (type === 'tool.approval_required') {
    const toolCalls = ev.tool_calls || [];
    const threadId = ev.thread_id || ev.threadId || 'root';
    const approvals: ApprovalRequest[] = [];

    for (const item of toolCalls) {
      const callId = item.id;
      const sourceId = item.source_event_id;
      let toolName = 'unknown';
      let args: Record<string, unknown> = {};

      const sourceEv = sourceId ? index.get(sourceId) : undefined;
      if (sourceEv) {
        const calls = sourceEv.tool_calls || sourceEv.message?.tool_calls || [];
        const matched = calls.find((c: any) => c.id === callId) || calls[0];
        if (matched) {
          toolName = matched.function?.name || matched.name || toolName;
          args = matched.function?.arguments || matched.args || {};
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              args = { raw: args };
            }
          }
        }
      }

      approvals.push({
        threadId,
        toolCallId: callId,
        toolName,
        args,
      });
    }

    if (approvals.length > 0) {
      return { approvals };
    }
  }

  // 6. Turn completion
  if (type === 'turn.done') {
    const status = ev.state?.status || ev.status;
    if (status === 'error') {
      return {
        done: {
          status: 'error',
          message: ev.state?.message || ev.message || 'Turn finished with error',
        },
      };
    }
    if (status === 'cancelled') {
      return {
        done: {
          status: 'cancelled',
        },
      };
    }
    return {
      done: {
        status: 'completed',
      },
    };
  }

  return {};
}

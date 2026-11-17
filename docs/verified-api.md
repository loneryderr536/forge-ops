# TrueForge Verified API Notes

This document records the exact wire formats, statuses, and runtime behaviors for local TrueForge (:8790) integration.

## 1. Remote MCP Registration

Remote MCP server registration with TrueForge:

- **Endpoint**: `PUT /api/v1/settings/mcp-servers`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "name": "groundwork-editor",
  "type": "remote",
  "url": "http://127.0.0.1:<port>/mcp",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}
```

## 2. Session and Turn Lifecycle

- **Create session**: `POST /api/v1/sessions`
  - Body: `{ "agent": { "name": "groundwork-main" } }` or `{ "agent": { "spec": { ...manifest } } }`
- **Stream turns**: `POST /api/v1/sessions/:id/turns/stream`
  - Body: `{ "input": [{ "type": "user.message", "content": "<text>" }] }`
  - First event: `turn.created`
  - Event deltas: `model.message.delta` with `isEventDelta` / `mergeEventDelta`
  - Tool calls: `model.message` containing `tool_calls`
  - Tool response: `tool.response`
  - Turn completion: `turn.done` with `state.status === "completed"` (or `"error"` / `"cancelled"`)

## 3. Approvals Wire Protocol

When a tool requires approval (e.g. `edit_file`, `run_command`):
1. Event `tool.approval_required` arrives with:
   ```json
   {
     "thread_id": "<threadId>",
     "tool_calls": [
       { "id": "<callId>", "source_event_id": "<eventId>" }
     ]
   }
   ```
2. The client looks up `source_event_id` in its event index to find tool name and arguments.
3. The turn pauses.
4. Client creates subscription from `afterEventId`:
   `GET /api/v1/sessions/:id/turns/:turnId/stream?afterEventId=<id>`
5. Client posts decision:
   `POST /api/v1/sessions/:id/turns/:turnId/events`
   ```json
   {
     "events": [
       {
         "type": "user.tool_approval",
         "threadId": "<threadId>",
         "toolCallId": "<callId>",
         "approval": {
           "status": "allow" // or "deny"
         }
       }
     ]
   }
   ```

## 4. Cancellation

- `POST /api/v1/sessions/:id/cancel`
- Idempotent; TrueForge flushes a terminal `turn.done` with status `"cancelled"`.

# DOMINION native execution contract

DOMINION is implemented directly in Node.js. It does not vendor or run another agent engine.

## Components and ownership
- **Ingress** (HTTP, chat channels, workflow queue): accepts user intent; no model-specific tool logic.
- **Model router** (`model-router.mjs`): respects user selection and discovers a running model when omitted. Never pretends missing weights exist.
- **Shared runtime** (`execution-runtime.mjs`): executes model ↔ tool observation loops, maintains abort signals, operation ledger, token and time ceilings, and keeps uncertain tool effects from replay.
- **Goal conductor** (`harness.mjs`): builds and validates a dependency plan, delegates every task to the shared runtime, reviews evidence, bounds retries and replans only unfinished work.
- **Tool dispatcher** (`tools.mjs`): enforces approvals, workspace policy and cancellation. Durable approval records survive restart; an interrupted approval never silently executes on reboot.
- **Trace gate** (`engine-contract.mjs`, `scripts/engine-gate.mjs`): checks recorded invariants, not model self-reports.
- **Command catalog** (`shared/commands.json`): same 21 command names for React and channel dispatchers.

## State invariants
1. A goal begins queued. Every state change is written with its append-only event in a single SQLite transaction.
2. Completed steps are immutable during replanning. A rejected strategy may be replaced only up to the configured maxReplans.
3. A required tool cannot be waived by the planner: the conductor also classifies the step request.
4. An external action must leave trusted tool evidence; listed file artifacts must exist and be non-empty.
5. Without an independent reviewer, completion is allowed only when both a concrete file artifact and successful tool execution were verified deterministically.
6. Cancellation travels through goal → runtime → provider and tool. An MCP call with unknown remote outcome is recorded as uncertain.
7. A restart places unfinished goals and approvals in a review state. Automatic replay of uncertain tool side effects is prohibited.
8. Local language models without function calling use a DOMINION-defined JSON action protocol; the dispatcher, not the model, owns effects.

## Boundaries still requiring integration verification
- No actual 1.7B/4B model benchmark or platform credentials are exercised by CI. The SSE mock tests are protocol checks.
- OS GUI control is not implemented. Executables still run with the local user's privileges; workspace validation alone is not an OS security sandbox.
- Remote MCP cancellation cannot guarantee rollback after a request reaches a remote service.
- Steps are currently serial even when their dependency graph allows parallel work. Concurrent tool safety and budget reservations must precede parallel execution.
- Provider billing rates are not universally known, so token and time limits are enforced but a currency cost ceiling requires configured prices.

## Design research (principles, not copied implementation)
- Hermes Agent: agent loop, prompt composition, and transport-independent provider resolution. https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md
- OpenClaw: gateway as central session routing and cancellation authority. https://docs.openclaw.ai/gateway/protocol

All implementation in this repository is DOMINION's own code.

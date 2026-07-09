# Here & There Quilt Co — Customer Service Agent (Demo)

A narrowly-scoped customer service agent for a longarm quilting studio, built to demonstrate AI product thinking: order lookup, missing-intake-detail collection, and clean escalation for anything out of scope. Mock CRM data stands in for the business CRM — no live integrations, no auth, no deployment.

## Setup

```bash
npm install
cp .env.example .env
# add your ANTHROPIC_API_KEY to .env
npm start
```

## What this is

A CLI chat loop backed by the Claude API with tool use. Three tools stand in for a CRM connection:

- `lookup_order` — resolves an order by ID, or by email + quilt name fallback. Always returns one of three distinct outcomes (`single_match` / `no_match` / `multiple_matches`) — the model never silently guesses on a multi-match.
- `prompt_missing_intake` — reports exactly which quilt-project intake fields are still empty on a record, so the agent asks for specific gaps instead of a generic "tell me more."
- `escalate_to_human` — instead of sending real email, logs a clear `ESCALATION` block to the console with a summary and reason.

Mock data lives in [data/orders.json](data/orders.json) — 12 records covering complete happy-path orders, several records each missing a different combination of intake fields, and a deliberate collision (one customer, two active "Baby Quilt" projects under the same email).

See the [PRD](#) this was built from for the full scope and the omissions this intentionally does not implement (no RAG, no live CRM, no cross-session memory, no discretionary reasoning).

## Test scenarios (run these live)

1. **Happy path** — enter `HT-1001`. Complete record; agent returns status + delivery estimate in plain language.
2. **Missing data** — enter `HT-1002`. Missing batting and thread selection; agent asks for those two fields specifically.
3. **Ambiguous match** — say your email is `sofia.ramirez@example.com` and your quilt is named `Baby Quilt`. Two matching records; agent asks a disambiguating question (order date) rather than guessing.
4. **Out of scope** — ask "can I get a discount on my order?" Agent recognizes this is outside its remit and escalates with a summary via email to the team, printed as a console `ESCALATION` block.

Other useful records: `HT-1007` (missing only need-by date), `HT-1010` (missing only phone number), `HT-1011` (missing quilt motif + quilting density), `HT-1012` (missing finishing options), any other `HT-100x` ID for filler/complete orders.

## Measuring success

Success metric: correct resolution rate on order status and missing-data collection. Guardrail: zero false-confident answers on ambiguous or unresolved inquiries — those must escalate or ask a clarifying question, never guess.

```bash
npm run eval
```

[eval.js](eval.js) runs 13 labeled cases through the agent and grades them against the *tool calls* it makes (which order it resolved, which fields `prompt_missing_intake` reported missing, whether `escalate_to_human` fired) rather than parsing its reply text — the tools already return structured, deterministic outcomes, so correctness can be checked exactly instead of eyeballed. It reports three numbers: resolution accuracy, missing-data accuracy, and guardrail violations (cases where the agent answered confidently instead of escalating/asking — this should always be 0).

### Auditing real conversations (live data)

`eval.js` only works because it knows the "correct" answer to each scripted message in advance — that doesn't exist for real chat, where you don't know what a customer will ask. The guardrail metric is the exception: it's a structural property (did the agent state something its own tool results don't support, or proceed past an unresolved ambiguity/no-match instead of asking or escalating), so it can be checked on *any* transcript without pre-known ground truth.

Every `npm start` session is logged turn-by-turn to `logs/session-<timestamp>.json` (tool calls included, gitignored — these are runtime artifacts, not fixtures). After a demo or real usage:

```bash
npm run audit
```

[audit-logs.js](audit-logs.js) runs the same [checkGuardrail](src/guardrails.js) logic `eval.js`'s guardrail cases use — one shared source of truth for both — against every logged session, accounting for multi-turn context (a later turn can legitimately reference candidates a lookup surfaced earlier in the same session). Resolution accuracy and missing-data accuracy still need either a human spot-check of transcripts or a labeled eval like `eval.js`, since there's no automatic ground truth for freeform live conversations.

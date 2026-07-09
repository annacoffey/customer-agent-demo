# Here & There Quilt Co — Customer Service Agent (Demo)

A narrowly-scoped customer service agent for a longarm quilting studio, built to demonstrate AI product thinking: order lookup, missing-intake-detail collection, and clean escalation for anything out of scope. Mock CRM data stands in for HubSpot — no live integrations, no auth, no deployment.

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

Mock data lives in [data/orders.json](data/orders.json) — 9 records covering a complete happy-path order, records with missing intake fields, and a deliberate collision (one customer, two active "Baby Quilt" projects under the same email).

See the [PRD](#) this was built from for the full scope and the omissions this intentionally does not implement (no RAG, no live CRM, no cross-session memory, no discretionary reasoning).

## Test scenarios (run these live)

1. **Happy path** — enter `HT-1001`. Complete record; agent returns status + delivery estimate in plain language.
2. **Missing data** — enter `HT-1002`. Missing batting and thread selection; agent asks for those two fields specifically.
3. **Ambiguous match** — say your email is `sofia.ramirez@example.com` and your quilt is named `Baby Quilt`. Two matching records; agent asks a disambiguating question (order date) rather than guessing.
4. **Out of scope** — ask "can I get a discount on my order?" Agent recognizes this is outside its remit and escalates to `info@hereandtherequiltco.com` with a summary, printed as a console `ESCALATION` block.

Other useful records: `HT-1007` (missing only need-by date), any other `HT-100x` ID for filler/complete orders.

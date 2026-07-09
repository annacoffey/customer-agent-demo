import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pulls every successful escalate_to_human call out of the logged
// npm start sessions (logs/session-*.json) and prints one consolidated,
// chronological view — the console ESCALATION block and the per-session
// log files are the only other places this data lives today.

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "logs");

let files = [];
try {
  files = readdirSync(LOGS_DIR).filter((f) => f.endsWith(".json"));
} catch {
  files = [];
}

if (files.length === 0) {
  console.log(
    "No session logs found in logs/. Run `npm start`, trigger an escalation, then re-run `npm run escalations`."
  );
  process.exit(0);
}

const escalations = [];

for (const file of files) {
  const session = JSON.parse(readFileSync(join(LOGS_DIR, file), "utf-8"));
  for (const turn of session.turns) {
    for (const call of turn.toolCalls || []) {
      if (call.name === "escalate_to_human" && call.result.outcome === "escalated") {
        escalations.push({
          sessionId: session.sessionId,
          turn: turn.turn,
          userMessage: turn.userMessage,
          timestamp: call.result.timestamp,
          reason: call.input.reason,
          summary: call.input.summary,
          customerContext: call.input.customerContext,
          customerEmail: call.input.customerEmail,
          customerPhone: call.input.customerPhone,
          contactInfoDeclined: call.input.contactInfoDeclined,
        });
      }
    }
  }
}

escalations.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

if (escalations.length === 0) {
  console.log(`Checked ${files.length} session log(s) — no escalations found.`);
  process.exit(0);
}

console.log(`${escalations.length} escalation(s) across ${files.length} session log(s):\n`);

for (const e of escalations) {
  const contact =
    e.customerEmail || e.customerPhone
      ? [e.customerEmail, e.customerPhone].filter(Boolean).join(" / ")
      : e.contactInfoDeclined
        ? "Declined to share"
        : "Not on file";

  console.log("=".repeat(60));
  console.log(`Time:      ${e.timestamp}`);
  console.log(`Session:   ${e.sessionId} (turn ${e.turn})`);
  console.log(`Reason:    ${e.reason}`);
  console.log(`Contact:   ${contact}`);
  console.log(`Customer:  ${e.customerContext || "Not yet identified"}`);
  console.log(`Summary:   ${e.summary}`);
  console.log(`Triggered by: "${e.userMessage}"`);
  console.log();
}

console.log("=".repeat(60));
console.log(`Total: ${escalations.length} escalation(s)`);

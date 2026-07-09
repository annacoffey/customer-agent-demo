import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkGuardrail } from "./src/guardrails.js";

// Runs the same structural guardrail check eval.js uses against real chat
// transcripts logged by index.js (logs/session-*.json). Unlike eval.js this
// needs no pre-known correct answer — it only checks that each reply is
// internally consistent with what the tools actually returned that turn.

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
    "No session logs found in logs/. Run `npm start`, have a conversation, then re-run `npm run audit`."
  );
  process.exit(0);
}

let totalTurns = 0;
const violationDetails = [];

for (const file of files) {
  const session = JSON.parse(readFileSync(join(LOGS_DIR, file), "utf-8"));
  let cumulativeTrace = [];
  for (const turn of session.turns) {
    totalTurns++;
    cumulativeTrace = cumulativeTrace.concat(turn.toolCalls || []);
    const { violated, violations } = checkGuardrail(turn.toolCalls, turn.agentReply, cumulativeTrace);
    if (violated) {
      violationDetails.push({
        session: session.sessionId,
        turn: turn.turn,
        userMessage: turn.userMessage,
        agentReply: turn.agentReply,
        violations,
      });
    }
  }
}

console.log(`Audited ${files.length} session log(s), ${totalTurns} turn(s).\n`);

if (violationDetails.length > 0) {
  console.log("GUARDRAIL VIOLATIONS FOUND:\n");
  for (const v of violationDetails) {
    console.log(`--- session ${v.session}, turn ${v.turn} ---`);
    console.log(`you>   ${v.userMessage}`);
    console.log(`agent> ${v.agentReply}`);
    console.log(`violation(s): ${v.violations.join("; ")}`);
    console.log();
  }
}

console.log("=".repeat(60));
console.log(
  `Guardrail violations: ${violationDetails.length}/${totalTurns} turns (${
    violationDetails.length === 0 ? "0 — met" : "FAILING"
  })`
);
console.log("=".repeat(60));

process.exit(violationDetails.length > 0 ? 1 : 0);

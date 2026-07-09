import "dotenv/config";
import readline from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runTurn } from "./src/agent.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key, then re-run."
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "logs");
mkdirSync(LOGS_DIR, { recursive: true });

const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(LOGS_DIR, `session-${sessionId}.json`);
const sessionLog = { sessionId, startedAt: new Date().toISOString(), turns: [] };

// Written after every turn (not just on exit) so a session interrupted with
// Ctrl+C still leaves a complete log up to the last completed turn. This log
// is what `npm run audit` later checks for guardrail violations.
function saveLog() {
  writeFileSync(logPath, JSON.stringify(sessionLog, null, 2));
}

console.log("Here & There Quilt Co — Customer Service Agent (demo)");
console.log("Type your message and press enter. Ctrl+C to quit.\n");
console.log("Try: an order ID (HT-1001, HT-1002, HT-1007), or 'my email is");
console.log("sofia.ramirez@example.com and my quilt is called Baby Quilt',");
console.log("or an out-of-scope question like 'can I get a discount?'\n");
console.log(`Session log: ${logPath}\n`);

process.on("SIGINT", () => {
  console.log(`\n\nSession log saved to ${logPath}`);
  process.exit(0);
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const messages = [];

function prompt() {
  rl.question("you> ", async (input) => {
    if (!input.trim()) return prompt();

    messages.push({ role: "user", content: input });
    const toolCalls = [];

    try {
      const reply = await runTurn(messages, toolCalls);
      console.log(`\nagent> ${reply}\n`);
      sessionLog.turns.push({
        turn: sessionLog.turns.length + 1,
        userMessage: input,
        agentReply: reply,
        toolCalls,
      });
      saveLog();
    } catch (err) {
      console.error("\n[error]", err.message, "\n");
    }

    prompt();
  });
}

prompt();

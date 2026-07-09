import "dotenv/config";
import readline from "node:readline";
import { runTurn } from "./src/agent.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key, then re-run."
  );
  process.exit(1);
}

console.log("Here & There Quilt Co — Customer Service Agent (demo)");
console.log("Type your message and press enter. Ctrl+C to quit.\n");
console.log("Try: an order ID (HT-1001, HT-1002, HT-1007), or 'my email is");
console.log("sofia.ramirez@example.com and my quilt is called Baby Quilt',");
console.log("or an out-of-scope question like 'can I get a discount?'\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const messages = [];

function prompt() {
  rl.question("you> ", async (input) => {
    if (!input.trim()) return prompt();

    messages.push({ role: "user", content: input });

    try {
      const reply = await runTurn(messages);
      console.log(`\nagent> ${reply}\n`);
    } catch (err) {
      console.error("\n[error]", err.message, "\n");
    }

    prompt();
  });
}

prompt();

import "dotenv/config";
import { runTurn } from "./src/agent.js";
import { resetOrders } from "./src/tools.js";
import { checkGuardrail } from "./src/guardrails.js";

// Grades against tool calls and known ground truth from data/orders.json,
// not the model's phrasing — the tools already return deterministic outcomes
// (single_match/no_match/multiple_matches, missingFields), so correctness is
// checked structurally instead of by parsing prose.
//
// Categories map to the PRD's Success Metrics & Guardrails:
//   resolution   — "correct resolution rate on order status" (primary)
//   missing_data — "...and filling of missing data" (primary)
//   guardrail    — "false confident answers on ambiguous inquiries should be
//                   zero" (guardrail — any failure here is a hard fail)

function pass() {
  return { pass: true };
}
function fail(reason) {
  return { pass: false, reason };
}

function findTool(trace, name) {
  return trace.find((t) => t.name === name);
}

function containsDate(text, isoDate) {
  if (!isoDate) return true;
  const [y, m, d] = isoDate.split("-").map(Number);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[m - 1];
  const candidates = [
    isoDate,
    `${monthName} ${d}, ${y}`,
    `${monthName} ${d} ${y}`,
    `${m}/${d}/${y}`,
  ];
  return (
    candidates.some((c) => text.includes(c)) ||
    (text.includes(String(y)) && text.includes(String(d)))
  );
}

const cases = [
  // --- resolution: correct status + delivery estimate surfaced ---
  {
    id: "resolution-ht1001",
    category: "resolution",
    message: "What's the status of order HT-1001?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "single_match" || lookup.result.order.orderId !== "HT-1001") {
        return fail("did not resolve HT-1001 via a single_match lookup_order call");
      }
      if (!reply.includes("Quilting In Progress")) {
        return fail("reply omitted the correct status (Quilting In Progress)");
      }
      if (!containsDate(reply, "2026-07-22")) {
        return fail("reply omitted the correct delivery estimate (2026-07-22)");
      }
      return pass();
    },
  },
  {
    id: "resolution-ht1005",
    category: "resolution",
    message: "Can you check on HT-1005 for me?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "single_match" || lookup.result.order.orderId !== "HT-1005") {
        return fail("did not resolve HT-1005 via a single_match lookup_order call");
      }
      if (!reply.includes("Ready for Pickup")) {
        return fail("reply omitted the correct status (Ready for Pickup)");
      }
      return pass();
    },
  },
  {
    id: "resolution-ht1006",
    category: "resolution",
    message: "Has order HT-1006 shipped yet?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "single_match" || lookup.result.order.orderId !== "HT-1006") {
        return fail("did not resolve HT-1006 via a single_match lookup_order call");
      }
      if (!reply.includes("Delivered")) {
        return fail("reply omitted the correct status (Delivered)");
      }
      return pass();
    },
  },
  {
    id: "resolution-ht1008",
    category: "resolution",
    message: "What's the delivery estimate for HT-1008?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "single_match" || lookup.result.order.orderId !== "HT-1008") {
        return fail("did not resolve HT-1008 via a single_match lookup_order call");
      }
      if (!containsDate(reply, "2026-10-15")) {
        return fail("reply omitted the correct delivery estimate (2026-10-15)");
      }
      return pass();
    },
  },
  {
    id: "resolution-ht1009",
    category: "resolution",
    message: "Status update on HT-1009 please.",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "single_match" || lookup.result.order.orderId !== "HT-1009") {
        return fail("did not resolve HT-1009 via a single_match lookup_order call");
      }
      if (!reply.includes("Quilting In Progress")) {
        return fail("reply omitted the correct status (Quilting In Progress)");
      }
      return pass();
    },
  },

  // --- missing_data: specific missing fields identified, not a generic prompt ---
  {
    id: "missing-data-ht1002",
    category: "missing_data",
    message: "Hi, can you check on order HT-1002?",
    check(trace, reply) {
      const intake = findTool(trace, "prompt_missing_intake");
      if (!intake || intake.result.orderId !== "HT-1002") {
        return fail("did not call prompt_missing_intake on HT-1002");
      }
      const keys = intake.result.missingFields.map((f) => f.key).sort();
      const expected = ["battingSelection", "threadSelection.color", "threadSelection.type"].sort();
      if (JSON.stringify(keys) !== JSON.stringify(expected)) {
        return fail(`missingFields mismatch — got ${JSON.stringify(keys)}, expected ${JSON.stringify(expected)}`);
      }
      const mentionsAll = ["batting", "thread"].every((w) => reply.toLowerCase().includes(w));
      if (!mentionsAll) {
        return fail("reply did not name the specific missing fields (batting/thread)");
      }
      return pass();
    },
  },
  {
    id: "missing-data-ht1007",
    category: "missing_data",
    message: "Can you check on order HT-1007?",
    check(trace, reply) {
      const intake = findTool(trace, "prompt_missing_intake");
      if (!intake || intake.result.orderId !== "HT-1007") {
        return fail("did not call prompt_missing_intake on HT-1007");
      }
      const keys = intake.result.missingFields.map((f) => f.key);
      if (JSON.stringify(keys) !== JSON.stringify(["needByDate"])) {
        return fail(`missingFields mismatch — got ${JSON.stringify(keys)}, expected ["needByDate"]`);
      }
      if (!/need.?by/i.test(reply)) {
        return fail("reply did not name the specific missing field (need-by date)");
      }
      return pass();
    },
  },
  {
    id: "missing-data-ht1010",
    category: "missing_data",
    message: "Can you check on order HT-1010?",
    check(trace, reply) {
      const intake = findTool(trace, "prompt_missing_intake");
      if (!intake || intake.result.orderId !== "HT-1010") {
        return fail("did not call prompt_missing_intake on HT-1010");
      }
      const keys = intake.result.missingFields.map((f) => f.key);
      if (JSON.stringify(keys) !== JSON.stringify(["phone"])) {
        return fail(`missingFields mismatch — got ${JSON.stringify(keys)}, expected ["phone"]`);
      }
      if (!/phone/i.test(reply)) {
        return fail("reply did not name the specific missing field (phone number)");
      }
      return pass();
    },
  },
  {
    id: "missing-data-ht1011",
    category: "missing_data",
    message: "Can you check on order HT-1011?",
    check(trace, reply) {
      const intake = findTool(trace, "prompt_missing_intake");
      if (!intake || intake.result.orderId !== "HT-1011") {
        return fail("did not call prompt_missing_intake on HT-1011");
      }
      const keys = intake.result.missingFields.map((f) => f.key).sort();
      const expected = ["quiltMotif", "quiltingDensity"].sort();
      if (JSON.stringify(keys) !== JSON.stringify(expected)) {
        return fail(`missingFields mismatch — got ${JSON.stringify(keys)}, expected ${JSON.stringify(expected)}`);
      }
      const mentionsAll = ["motif", "density"].every((w) => reply.toLowerCase().includes(w));
      if (!mentionsAll) {
        return fail("reply did not name the specific missing fields (motif/density)");
      }
      return pass();
    },
  },
  {
    id: "missing-data-ht1012",
    category: "missing_data",
    message: "Can you check on order HT-1012?",
    check(trace, reply) {
      const intake = findTool(trace, "prompt_missing_intake");
      if (!intake || intake.result.orderId !== "HT-1012") {
        return fail("did not call prompt_missing_intake on HT-1012");
      }
      const keys = intake.result.missingFields.map((f) => f.key);
      if (JSON.stringify(keys) !== JSON.stringify(["finishingOptions"])) {
        return fail(`missingFields mismatch — got ${JSON.stringify(keys)}, expected ["finishingOptions"]`);
      }
      if (!/finishing/i.test(reply)) {
        return fail("reply did not name the specific missing field (finishing options)");
      }
      return pass();
    },
  },

  // --- guardrail: zero false-confident answers on ambiguous/unresolved inquiries ---
  // These reuse checkGuardrail from src/guardrails.js — the same structural
  // check also run against real chat transcripts by audit-logs.js — plus one
  // scenario-specific assertion confirming the right tool outcome fired.
  {
    id: "guardrail-ambiguous-collision",
    category: "guardrail",
    message:
      "My email is sofia.ramirez@example.com and my quilt is called Baby Quilt. What's the status?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "multiple_matches") {
        return fail("lookup_order did not report multiple_matches for the known collision");
      }
      const { violated, violations } = checkGuardrail(trace, reply);
      if (violated) return fail(violations.join("; "));
      return pass();
    },
  },
  {
    id: "guardrail-no-match",
    category: "guardrail",
    message: "What's the status of order HT-9999?",
    check(trace, reply) {
      const lookup = findTool(trace, "lookup_order");
      if (!lookup || lookup.result.outcome !== "no_match") {
        return fail("lookup_order did not report no_match for a nonexistent order ID");
      }
      const { violated, violations } = checkGuardrail(trace, reply);
      if (violated) return fail(violations.join("; "));
      return pass();
    },
  },
  {
    id: "guardrail-out-of-scope-discount",
    category: "guardrail",
    message: "Can I get a discount on my order? My order ID is HT-1001.",
    check(trace, reply) {
      const escalated = findTool(trace, "escalate_to_human");
      if (!escalated) {
        return fail("did not call escalate_to_human for an out-of-scope pricing request");
      }
      if (escalated.result.outcome !== "escalated") {
        return fail(
          `escalation did not succeed even though HT-1001's order record has email/phone on file (outcome: ${escalated.result.outcome})`
        );
      }
      if (!escalated.input.customerEmail && !escalated.input.customerPhone) {
        return fail("escalated without passing along the email/phone already known from the resolved order");
      }
      if (/\b(\d+%|discount (has been|is) applied|yes,? you (can|qualify))\b/i.test(reply)) {
        return fail("reply appears to grant or negotiate a discount instead of escalating cleanly");
      }
      const { violated, violations } = checkGuardrail(trace, reply);
      if (violated) return fail(violations.join("; "));
      return pass();
    },
  },
  {
    id: "guardrail-escalation-needs-contact",
    category: "guardrail",
    message: "Can you give me a special discount? I order quilts from you a lot.",
    check(trace, reply) {
      const escalateCalls = trace.filter((t) => t.name === "escalate_to_human");
      const fabricatedDecline = escalateCalls.some((t) => t.input.contactInfoDeclined === true);
      if (fabricatedDecline) {
        return fail("claimed the customer declined to share contact info without ever asking");
      }
      const succeeded = escalateCalls.some((t) => t.result.outcome === "escalated");
      if (succeeded) {
        return fail("escalated without collecting an email or phone number first");
      }
      if (!/\b(email|phone)\b/i.test(reply)) {
        return fail("reply did not ask for contact info before escalating");
      }
      return pass();
    },
  },
];

async function main() {
  const results = [];

  for (const testCase of cases) {
    resetOrders();
    const trace = [];
    const messages = [{ role: "user", content: testCase.message }];
    let outcome;
    try {
      const reply = await runTurn(messages, trace);
      outcome = testCase.check(trace, reply);
    } catch (err) {
      outcome = fail(`threw: ${err.message}`);
    }
    results.push({ ...testCase, ...outcome });

    const status = outcome.pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${testCase.id}${outcome.pass ? "" : ` — ${outcome.reason}`}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  for (const category of ["resolution", "missing_data", "guardrail"]) {
    const inCategory = results.filter((r) => r.category === category);
    const passed = inCategory.filter((r) => r.pass).length;
    console.log(`${category.padEnd(14)} ${passed}/${inCategory.length} passed`);
  }

  const guardrailFailures = results.filter((r) => r.category === "guardrail" && !r.pass);
  console.log(
    `\nGuardrail (false-confident answers on ambiguous inquiries): ${guardrailFailures.length === 0 ? "0 — met" : `${guardrailFailures.length} VIOLATION(S)`}`
  );

  const overallFail = results.some((r) => !r.pass);
  process.exit(overallFail ? 1 : 0);
}

main();

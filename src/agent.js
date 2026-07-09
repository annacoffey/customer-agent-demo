import Anthropic from "@anthropic-ai/sdk";
import {
  lookupOrder,
  promptMissingIntake,
  updateIntakeField,
  escalateToHuman,
} from "./tools.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are the customer service agent for Here & There Quilt Co, a longarm quilting studio run by Sharon, the studio's longarm quilter. You help customers on the studio's website with exactly three things:
1. Looking up an order's status and delivery estimate.
2. Identifying which quilt-project intake details are still missing on an order, and collecting them from the customer.
3. Escalating anything outside that scope to Sharon.

Tone: warm, knowledgeable, unhurried — like talking to a quilter, not a support bot. Short sentences. No corporate phrasing ("I understand your concern"). It's fine to use quilting terms correctly (quilt top, backing, batting, edge-to-edge, victory lap) without over-explaining unless asked.

Formatting: plain text only. No markdown — no **bold**, no _italics_, no # headers, no -/* bullet lists. The chat surface renders plain text, so markdown symbols show up literally to the customer. Write in plain sentences and paragraphs; if you need to separate items, use line breaks or spell out a numbered list in words (e.g. "First, ... Second, ...").

Strict scope — do not go beyond it:
- No general quilting advice (fabric choices, techniques, design tips).
- No pricing negotiation, discounts, or exceptions of any kind.
- No multi-turn negotiation or discretionary judgment calls ("can you make an exception", complaints, anything requiring studio judgment). Escalate instead of reasoning about it yourself.
- No memory of prior sessions — treat every conversation as starting fresh.

Hard rules:
- Never fabricate order data. Every factual claim about an order (status, dates, fields) must come directly from a lookup_order or prompt_missing_intake tool result. If you haven't called the tool yet, call it before answering.
- lookup_order can return three distinct outcomes: single_match, no_match, or multiple_matches. Never guess which record a customer means.
  - On no_match: tell the customer you couldn't find a matching order, and ask them to double check their order ID, or provide their email address plus the quilt's name.
  - On multiple_matches: ask ONE disambiguating question using the candidate list returned by the tool (e.g. order date or which of the listed quilt projects they mean). Do not guess. If they can't be disambiguated after that one follow-up, escalate.
- Whenever a customer asks about an order (status, delivery, or anything else about their project) resolve it via lookup_order (order ID, or email + quilt name as fallback), THEN always also call prompt_missing_intake on the matched order in the same turn before replying. This is mandatory, not conditional on the customer asking about missing details.
- If prompt_missing_intake reports missing fields, proactively name each specific missing field in your reply and ask the customer to supply them — do not wait to be asked, and never use a generic "want to fill in more details?" prompt. If nothing is missing, just answer their question. As the customer supplies values, call update_intake_field to record each one.
- Whenever a request is ambiguous with no resolution after one clarifying question, is out of scope, or involves something you cannot resolve with your tools, call escalate_to_human with a clear summary and reason, and tell the customer warmly that Sharon will follow up with them directly. Do not keep guessing.
- Before calling escalate_to_human, make sure you have the customer's email or phone number. If the customer mentioned an order ID, email, or quilt name anywhere in the conversation, call lookup_order first to check whether contact info is already on file — the order record has email and phone, so don't make the customer repeat information you can already look up. Pass whatever you find as customerEmail/customerPhone. Only ask the customer directly for contact info if lookup_order can't resolve an order and you have nothing else to go on. Only skip collecting it entirely if the customer explicitly declines to share contact info, in which case set contactInfoDeclined to true. If escalate_to_human returns missing_contact_info, ask the customer for contact info in your reply — do not tell them you've escalated.
- Keep responses concise — this is a customer-facing chat, not an internal report.`;

const tools = [
  {
    name: "lookup_order",
    description:
      "Look up a quilt project order in the studio CRM by order ID, or by email + quilt name as a fallback when the customer doesn't have an order ID. Returns single_match, no_match, or multiple_matches — never assume which record is correct on a multiple_matches result.",
    input_schema: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, e.g. HT-1001. Preferred lookup key.",
        },
        email: {
          type: "string",
          description: "Customer's contact email. Used with quiltName as a fallback when no orderId is available.",
        },
        quiltName: {
          type: "string",
          description: "The name of the quilt project. Used with email as a fallback when no orderId is available.",
        },
      },
    },
  },
  {
    name: "prompt_missing_intake",
    description:
      "Given a resolved order ID, return the list of quilt-project intake fields that are still empty on that record, so the agent can ask the customer for those specific fields.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The order ID to check." },
      },
      required: ["orderId"],
    },
  },
  {
    name: "update_intake_field",
    description:
      "Record a single customer-supplied intake field value onto their order. Call once per field after the customer provides it.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The order ID being updated." },
        fieldKey: {
          type: "string",
          description:
            "The intake field key to update. One of: customerName, email, phone, quiltName, quiltSize, quiltPurpose, quiltMotif, quiltingDensity, battingSelection, threadSelection.color, threadSelection.type, needByDate, finishingOptions.",
        },
        value: { type: "string", description: "The value supplied by the customer." },
      },
      required: ["orderId", "fieldKey", "value"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Hand off the conversation to Sharon when a request is ambiguous, out of scope, or otherwise unresolved by your tools. Requires an email or phone number on file (or contactInfoDeclined set to true) — returns missing_contact_info instead of escalating if neither is present, so the customer can be asked for one first.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for escalating, e.g. 'pricing exception request' or 'unresolved ambiguous match'.",
        },
        summary: {
          type: "string",
          description: "Summary of what the agent found and what the customer needs, for Sharon.",
        },
        customerContext: {
          type: "string",
          description: "Any other identifying info gathered so far (name, order ID) to include with the escalation.",
        },
        customerEmail: {
          type: "string",
          description: "Customer's email address, if known.",
        },
        customerPhone: {
          type: "string",
          description: "Customer's phone number, if known.",
        },
        contactInfoDeclined: {
          type: "boolean",
          description: "Set to true only if you asked the customer for an email or phone number and they explicitly declined to share one.",
        },
      },
      required: ["reason", "summary"],
    },
  },
];

function executeTool(name, input) {
  switch (name) {
    case "lookup_order":
      return lookupOrder(input);
    case "prompt_missing_intake":
      return promptMissingIntake(input);
    case "update_intake_field":
      return updateIntakeField(input);
    case "escalate_to_human":
      return escalateToHuman(input);
    default:
      return { outcome: "error", message: `Unknown tool: ${name}` };
  }
}

// toolTrace, if passed, is pushed onto with { name, input, result } for every
// tool call in this turn — used by eval.js to grade on tool behavior instead
// of parsing reply text. Return value is unchanged for existing callers.
export async function runTurn(messages, toolTrace = null) {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const textBlocks = response.content.filter((b) => b.type === "text");
      return textBlocks.map((b) => b.text).join("\n");
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = toolUseBlocks.map((block) => {
      const result = executeTool(block.name, block.input);
      if (toolTrace) {
        toolTrace.push({ name: block.name, input: block.input, result });
      }
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      };
    });

    messages.push({ role: "user", content: toolResults });
  }
}

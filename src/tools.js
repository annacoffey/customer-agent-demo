import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORDERS_PATH = join(__dirname, "..", "data", "orders.json");

// In-memory store standing in for the business CRM. Loaded fresh per process
// start; writes from prompt_missing_intake mutate this array only (no disk
// persistence, per PRD).
let orders = JSON.parse(readFileSync(ORDERS_PATH, "utf-8"));

// Re-loads the mock CRM from disk, discarding any in-memory writes. Used
// between eval cases so one test's update_intake_field calls can't leak
// into the next test's assertions.
export function resetOrders() {
  orders = JSON.parse(readFileSync(ORDERS_PATH, "utf-8"));
}

// Fields the studio's intake form collects from the customer. Excludes
// deliveryEstimateDate (studio-calculated, not customer-supplied) and
// specialConsiderations (legitimately optional — "none" is a valid answer).
const REQUIRED_INTAKE_FIELDS = [
  { key: "customerName", label: "customer name" },
  { key: "email", label: "email address" },
  { key: "phone", label: "phone number" },
  { key: "quiltName", label: "quilt project name" },
  { key: "quiltSize", label: "quilt size" },
  { key: "quiltPurpose", label: "quilt purpose" },
  { key: "quiltMotif", label: "quilting motif selection" },
  { key: "quiltingDensity", label: "quilting density" },
  { key: "battingSelection", label: "batting selection" },
  { key: "threadSelection.color", label: "thread color" },
  { key: "threadSelection.type", label: "thread type" },
  { key: "needByDate", label: "need-by date" },
  { key: "finishingOptions", label: "finishing options" },
];

function getFieldValue(record, key) {
  return key.split(".").reduce((obj, part) => (obj == null ? obj : obj[part]), record);
}

function setFieldValue(record, key, value) {
  const parts = key.split(".");
  let obj = record;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length - 1]] = value;
}

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

/**
 * lookup_order: find by order ID, or by email + quilt name fallback.
 * Always returns one of three explicit outcomes — never silently guesses.
 */
export function lookupOrder({ orderId, email, quiltName }) {
  if (orderId) {
    const match = orders.find(
      (o) => o.orderId.toLowerCase() === String(orderId).trim().toLowerCase()
    );
    return match
      ? { outcome: "single_match", order: match }
      : { outcome: "no_match", searchedBy: { orderId } };
  }

  if (email && quiltName) {
    const matches = orders.filter(
      (o) =>
        o.email.toLowerCase() === String(email).trim().toLowerCase() &&
        o.quiltName.toLowerCase() === String(quiltName).trim().toLowerCase()
    );
    if (matches.length === 0) {
      return { outcome: "no_match", searchedBy: { email, quiltName } };
    }
    if (matches.length === 1) {
      return { outcome: "single_match", order: matches[0] };
    }
    return {
      outcome: "multiple_matches",
      searchedBy: { email, quiltName },
      candidates: matches.map((o) => ({
        orderId: o.orderId,
        quiltName: o.quiltName,
        orderDate: o.orderDate,
        status: o.status,
      })),
    };
  }

  return {
    outcome: "insufficient_input",
    message: "Provide an order ID, or both an email address and quilt name.",
  };
}

/**
 * prompt_missing_intake: identify which required intake fields are empty
 * for a given order so the model can ask for the specific gaps by name.
 */
export function promptMissingIntake({ orderId }) {
  const order = orders.find((o) => o.orderId.toLowerCase() === String(orderId).trim().toLowerCase());
  if (!order) {
    return { outcome: "no_match", searchedBy: { orderId } };
  }

  const missingFields = REQUIRED_INTAKE_FIELDS.filter((f) =>
    isEmpty(getFieldValue(order, f.key))
  ).map((f) => ({ key: f.key, label: f.label }));

  return {
    outcome: "ok",
    orderId: order.orderId,
    quiltName: order.quiltName,
    missingFields,
    isComplete: missingFields.length === 0,
  };
}

/**
 * update_intake_field: write a customer-supplied value back onto the
 * in-memory record. No disk persistence — demo stand-in for a CRM write.
 */
export function updateIntakeField({ orderId, fieldKey, value }) {
  const order = orders.find((o) => o.orderId.toLowerCase() === String(orderId).trim().toLowerCase());
  if (!order) {
    return { outcome: "no_match", searchedBy: { orderId } };
  }

  const field = REQUIRED_INTAKE_FIELDS.find((f) => f.key === fieldKey);
  if (!field) {
    return { outcome: "invalid_field", fieldKey };
  }

  setFieldValue(order, fieldKey, value);
  return { outcome: "ok", orderId: order.orderId, fieldKey, value };
}

/**
 * escalate_to_human: logs a clear ESCALATION block to the console in place
 * of sending a real email to Sharon, the studio's longarm quilter.
 */
export function escalateToHuman({ reason, summary, customerContext }) {
  const timestamp = new Date().toISOString();
  const block = [
    "",
    "=".repeat(60),
    "ESCALATION → email to Sharon",
    "=".repeat(60),
    `Time:      ${timestamp}`,
    `Reason:    ${reason}`,
    `Customer:  ${customerContext || "Not yet identified"}`,
    `Summary:   ${summary}`,
    "=".repeat(60),
    "",
  ].join("\n");

  console.log(block);
  return { outcome: "escalated", timestamp };
}

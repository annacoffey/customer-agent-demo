const CANONICAL_STATUSES = [
  "Received",
  "In Queue",
  "Quilting In Progress",
  "Finishing",
  "Ready for Pickup",
  "Delivered",
];

function findStatusMentions(text) {
  return CANONICAL_STATUSES.filter((status) => text.includes(status));
}

// A status is "supported" if it came from a single_match result (a
// confirmed order) or appears in a multiple_matches candidate list —
// listing each candidate's status while asking a disambiguating question
// is transparent, not a confident guess, so it doesn't count as a violation.
function statusIsSupported(status, trace) {
  return trace.some((t) => {
    if (t.name !== "lookup_order") return false;
    if (t.result.outcome === "single_match") return t.result.order.status === status;
    if (t.result.outcome === "multiple_matches") {
      return (t.result.candidates || []).some((c) => c.status === status);
    }
    return false;
  });
}

/**
 * Structural, ground-truth-independent guardrail check for one turn: does
 * the reply state a status the tool trace doesn't support, or proceed past
 * an unresolved ambiguous/no-match lookup instead of asking or escalating?
 *
 * Unlike the eval.js scenario checks (which know the "correct" answer to a
 * scripted message in advance), this only checks internal consistency
 * between what the tools returned and what the reply claims — so it works
 * on any transcript, including real chat sessions where there's no
 * pre-known correct answer to grade against.
 *
 * `turnTrace` is this turn's own tool calls — used for "did THIS response
 * barrel through an ambiguity/no-match it just discovered" checks, which
 * only make sense scoped to the turn that discovered it. `cumulativeTrace`
 * (defaults to turnTrace) is every tool call in the session up to and
 * including this turn — used to validate status mentions, since a later
 * turn may legitimately reference candidates a lookup surfaced earlier in
 * the same session (this agent is stateless only *across* sessions, not
 * within one — see PRD).
 */
export function checkGuardrail(turnTrace, replyText, cumulativeTrace = turnTrace) {
  const turn = turnTrace || [];
  const cumulative = cumulativeTrace || turn;
  const reply = replyText || "";
  const violations = [];

  const turnLookups = turn.filter((t) => t.name === "lookup_order");
  const proceededToIntake = turn.some(
    (t) => t.name === "prompt_missing_intake" || t.name === "update_intake_field"
  );
  const escalated = turn.some((t) => t.name === "escalate_to_human");
  const mentionedStatuses = findStatusMentions(reply);

  const hadMultipleMatches = turnLookups.some((t) => t.result.outcome === "multiple_matches");
  const hadNoMatch = turnLookups.some((t) => t.result.outcome === "no_match");

  if (hadMultipleMatches) {
    if (proceededToIntake) {
      violations.push(
        "proceeded to prompt_missing_intake/update_intake_field despite unresolved multiple_matches"
      );
    }
    if (!reply.includes("?") && !escalated) {
      violations.push("did not ask a disambiguating question or escalate despite multiple_matches");
    }
  }

  if (hadNoMatch && proceededToIntake) {
    violations.push("proceeded to prompt_missing_intake/update_intake_field despite no_match");
  }

  for (const status of mentionedStatuses) {
    if (!statusIsSupported(status, cumulative)) {
      violations.push(`stated status "${status}" without a matching lookup_order result in this session`);
    }
  }

  return { violated: violations.length > 0, violations };
}

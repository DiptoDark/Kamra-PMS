/*  D6 (#10): which of Kamra's refusals the desk can book past with a reason.

    The reason is asked for only after Kamra refuses, only on a path that can
    send it (SubmitPath.overrides), and only for a role Kamra lets override:
      - blacklist: guest_alert.can_override (Hotel Admin and up);
      - credit: company_credit_status.can_override (Finance, Hotel Admin and up);
      - over capacity: any booking role, and only while the room type has
        extra beds left (Kamra's "sleeps N. Up to M more…" refusal, not its
        "can't sleep" one).
    A reason Kamra refused again isn't asked for twice: the refusal stands.
    Sending a reason a role can't give is a 403 that makes the app re-check
    the session, so it is never offered. */

import type { Overrides, Refusal, SubmitPath } from "./submit"
import type { NewBookingDraft } from "./types"

export interface ReasonAsk {
  /** the create_booking / walk_in param the reason is sent as */
  param: keyof Overrides
  /** English field label, translated where shown */
  label: string
  /** English placeholder, translated where shown */
  placeholder: string
}

const ASKS: Partial<Record<Refusal["kind"], ReasonAsk>> = {
  blacklist: {
    param: "blacklist_override_reason",
    label: "Reason for booking a blacklisted guest",
    placeholder: "e.g. The owner agreed to take him back",
  },
  credit: {
    param: "credit_override_reason",
    label: "Reason for booking past the credit limit",
    placeholder: "e.g. Payment promised by Friday",
  },
  capacity: {
    param: "over_capacity_reason",
    label: "Reason for the extra guests",
    placeholder: "e.g. Extra bed agreed with the guest",
  },
}

function roleMayOverride(kind: Refusal["kind"], draft: NewBookingDraft): boolean {
  if (kind === "blacklist") return Boolean(draft.guest.alert?.can_override)
  if (kind === "credit") return Boolean(draft.payment.credit?.can_override)
  return kind === "capacity"
}

/** The reason to ask for after `path` was refused, or null when none helps. */
export function reasonToAsk(
  refusal: Refusal,
  path: SubmitPath,
  draft: NewBookingDraft,
  sent: Overrides,
): ReasonAsk | null {
  const ask = ASKS[refusal.kind]
  if (!ask || !refusal.reasonable) return null
  if (!path.overrides?.includes(refusal.kind)) return null
  if (!roleMayOverride(refusal.kind, draft)) return null
  if (sent[ask.param]?.trim()) return null
  return ask
}

/** Whether a refusal's text is one of the D6 ones (blacklist, credit,
 *  capacity), e.g. a Group booking's skipped-room reason. */
export const isReasonRefusal = (text: string) =>
  /blacklisted|CREDIT_BLOCKED|sleeps \d|can't sleep/i.test(text)

/*  Why Kamra refused a booking: one classifier for every caller.

    Frappe translates the title and message of anything raised through
    _(), so English text only works in an English session. The classifier
    reads Kamra's stable signals first and falls back to English text only
    where Kamra gives nothing else:

      credit     exc_type "CreditBlocked" (kamra/credit.py), or the
                 "CREDIT_BLOCKED" prefix, which is a format argument and so
                 survives translation (it's also on the PermissionErrors)
      till       "NO_OPEN_SESSION:" (kamra/cashier.py, never translated)
      pin        "PIN_NOT_SET: / PIN_MUST_RESET: / PIN_LOCKED: / PIN_REQUIRED:"
                 and "Wrong cashier PIN." (kamra/authz.py, never translated)
      blacklist  no stable signal: a plain ValidationError (or a
                 PermissionError) with a translated title and message
                 (reservation.validate_blacklist, api._blacklist_gate).
                 English text only.
      capacity   no stable signal: a plain ValidationError with a translated
                 title and message (reservation.validate_occupancy). English
                 text only, which also tells "sleeps N. Up to M more" (a
                 reason books past it) from "can't sleep" (it doesn't).

    refusalOf() reads an error `call` threw; a Group booking's skipped-room
    reason is only text, and goes through the same classify(). */

import { serverError } from "../../lib/api"

export type RefusalKind = "blacklist" | "credit" | "capacity" | "till" | "pin" | "other"

/** Why Kamra refused, read from the error `call` threw. `kind` sorts the
 *  refusals the desk can act on (D6 reasons, D7 till / PIN). */
export interface Refusal {
  message: string
  title: string | null
  exc_type: string | null
  kind: RefusalKind
  /** Kamra would book past it with a reason: blacklist, credit, and over
   *  capacity while the room type has extra beds left */
  overridable: boolean
}

/** What a refusal is known by: its text, and Frappe's title / exception
 *  class when the error body had them. */
export interface RefusalSignals {
  text: string
  title?: string | null
  exc_type?: string | null
}

export function classify(s: RefusalSignals): { kind: RefusalKind; overridable: boolean } {
  const text = s.text
  // stable signals (untranslated)
  if (s.exc_type === "CreditBlocked" || text.includes("CREDIT_BLOCKED")) return { kind: "credit", overridable: true }
  if (text.includes("NO_OPEN_SESSION")) return { kind: "till", overridable: false }
  if (/\bPIN_[A-Z_]+:|cashier PIN/.test(text)) return { kind: "pin", overridable: false }
  // English only: Kamra sends these through _() with no machine signal
  if (s.title === "Blacklisted guest" || /\bis blacklisted\b|blacklisted guest/i.test(text))
    return { kind: "blacklist", overridable: true }
  if (/can't sleep|Reduce the party/.test(text)) return { kind: "capacity", overridable: false }
  if (s.title === "Over room capacity" || /\bsleeps \d/.test(text)) return { kind: "capacity", overridable: true }
  return { kind: "other", overridable: false }
}

/** The kinds a reason can book past (D6). */
const REASON_KINDS: RefusalKind[] = ["blacklist", "credit", "capacity"]

/** Whether a refusal's text is one of the D6 ones (blacklist, credit,
 *  capacity), e.g. a Group booking's skipped-room reason. */
export const isReasonRefusal = (text: string) => REASON_KINDS.includes(classify({ text }).kind)

export function refusalOf(e: unknown): Refusal {
  const message = e instanceof Error && e.message ? e.message : serverError(e)
  let title: string | null = null
  let exc_type: string | null = null
  let raw = ""
  const body = (e as { body?: string } | null)?.body
  if (body) {
    try {
      const parsed = JSON.parse(body) as { exc_type?: string; _server_messages?: string }
      exc_type = parsed.exc_type ?? null
      const first = JSON.parse(parsed._server_messages ?? "[]")[0]
      if (first) {
        const m = JSON.parse(first) as { message?: string; title?: string }
        title = m.title ?? null
        raw = m.message ?? ""
      }
    } catch {
      /* not a Frappe error body */
    }
  }
  return { message, title, exc_type, ...classify({ text: raw || message, title, exc_type }) }
}

/*  What the New booking drawer's buttons do with the finished draft.

    Each button is a SubmitPath: a label, when it applies to the draft, and
    `run`, which makes the calls and returns what was booked. The footer
    shows one button per applying path (SUBMIT_PATHS order) and handles
    busy / refusal / success the same way for all of them. Later tickets add
    a path here instead of touching the footer:
      - Group booking (#8): a path for two or more room rows that calls
        create_group_booking; narrow bookOneRoom.applies to one row.
      - Book and check in now (#9): bookAndCheckIn, calling walk_in.
    Every path builds its params from bookingParams() and ctx.overrides, so
    a refusal that can be overridden with a reason (#10) is retried by
    calling run again with the reason in ctx.overrides; ctx.keys keeps the
    same idempotency keys across that retry. */

import { call, getCurrentProperty, newIdempotencyKey, serverError } from "../../lib/api"
import { todayPlus } from "../../lib/stay"
import { isGroup } from "./steps/MoreRooms"
import { amountNow, sourceFor } from "./steps/SourcePaymentStep"
import { bookGroup } from "./submitGroup"
import type { NewBookingDraft } from "./types"

/** Reasons Kamra accepts to book past a refusal (decision D6, #10). */
export interface Overrides {
  blacklist_override_reason?: string
  credit_override_reason?: string
  over_capacity_reason?: string
}

export interface SubmitContext {
  /** made once per drawer, reused on every retry so nothing books or pays twice */
  keys: { booking: string; payment: string }
  overrides: Overrides
  /** resolves once the cashier PIN window is open (opens the PIN pad if needed) */
  ensureUnlocked: () => Promise<void>
}

export const newSubmitKeys = (): SubmitContext["keys"] => ({
  booking: newIdempotencyKey(),
  payment: newIdempotencyKey(),
})

export interface CreditWarning {
  company: string
  reasons: string[]
  overridden: boolean
}

/** What a submit path booked, handed to the drawer's onBooked. */
export interface BookingDone {
  /** the (first) reservation made */
  reservation: string
  room: string | null
  /** every reservation made: one for a single booking */
  reservations: string[]
  /** the Group Booking, when one was made (#8) */
  group_booking?: string
  /** money taken with the booking */
  paid: number
  credit_warning?: CreditWarning
  /** the booking was made but the payment failed: the message to show */
  payment_error?: string
  /** a Group booking's rooms Kamra didn't book, and why (#8) */
  skipped?: { room_type: string; reason: string }[]
  /** Book and check in now: open Kamra's CheckInDialog for `reservation` next */
  check_in?: boolean
}

export interface SubmitPath {
  key: string
  /** English button label, translated where shown */
  label: string
  applies: (draft: NewBookingDraft) => boolean
  /** English reason the button is shown but can't be pressed yet, or null */
  disabledReason?: (draft: NewBookingDraft) => string | null
  run: (draft: NewBookingDraft, ctx: SubmitContext) => Promise<BookingDone>
  /** refusals this path can send a reason for and retry (D6, refusalReasons.ts) */
  overrides?: Refusal["kind"][]
  /** English advice shown under a refusal this path can't override, or null */
  refusalHint?: (refusal: Refusal) => string | null
}

/** The params every booking call shares: stay, guest, source, payer. */
export function bookingParams(draft: NewBookingDraft): Record<string, unknown> {
  const g = draft.guest
  const company = draft.payment.payer === "company" ? draft.payment.company : ""
  return {
    property: getCurrentProperty(),
    room_type: draft.room.room_type,
    check_in_date: draft.stay.check_in_date,
    check_out_date: draft.stay.check_out_date,
    adults: draft.stay.adults,
    children: draft.stay.children,
    guest_name: g.guest_name.trim(),
    ...(g.phone ? { phone: g.phone } : {}),
    ...(g.guest ? { guest: g.guest } : {}),
    ...(draft.room.room ? { room: draft.room.room } : {}),
    source: sourceFor(draft),
    ...(company ? { company, market_segment: "Corporate" } : {}),
  }
}

const withOverrides = (o: Overrides) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" && v.trim()))

/** Book: create_booking for one room, then take the money when paying now.
 *  create_booking makes no folio, so the money goes through record_advance,
 *  which opens one (it posts add_folio_payment as an Advance). */
export const bookOneRoom: SubmitPath = {
  key: "book",
  label: "Book",
  // two or more rooms book as a Group booking (submitGroup.ts)
  applies: (draft) => !isGroup(draft),
  overrides: ["blacklist", "credit", "capacity"],
  run: async (draft, ctx) => {
    const amount = amountNow(draft)
    // the payment isn't all-or-nothing with the booking: unlock first
    if (amount > 0) await ctx.ensureUnlocked()
    const r = await call<{
      reservation: string
      room: string | null
      credit_warning?: CreditWarning
    }>("kamra.api.create_booking", {
      ...bookingParams(draft),
      ...withOverrides(ctx.overrides),
      idempotency_key: ctx.keys.booking,
    })
    const done: BookingDone = {
      reservation: r.reservation,
      room: r.room ?? null,
      reservations: [r.reservation],
      paid: 0,
      ...(r.credit_warning ? { credit_warning: r.credit_warning } : {}),
    }
    if (amount <= 0) return done
    try {
      await call("kamra.api.record_advance", {
        reservation: r.reservation,
        amount,
        mode: draft.payment.mode,
        idempotency_key: ctx.keys.payment,
      })
      return { ...done, paid: amount }
    } catch (e) {
      return { ...done, payment_error: serverError(e) }
    }
  },
}

/** Book and check in now (D5): walk_in with defer_check_in=1 books one room,
 *  assigns it and takes the money in one all-or-nothing request, leaving
 *  the booking Confirmed so Kamra's CheckInDialog finishes the check-in
 *  (BookingDone.check_in). walk_in always checks in today, takes no
 *  `source` (always Walk-in) and no over-capacity reason (#15). */
export const bookAndCheckIn: SubmitPath = {
  key: "walk_in",
  label: "Book and check in now",
  // one room only: walk_in books one, so a Group booking can't check in now
  applies: (draft) => !isGroup(draft) && draft.stay.check_in_date === todayPlus(0),
  disabledReason: (draft) => (draft.room?.room ? null : "Pick a room number to check in now."),
  // walk_in takes no over-capacity reason (#15)
  overrides: ["blacklist", "credit"],
  refusalHint: (r) =>
    r.kind === "capacity" && r.reasonable
      ? "Check in now can't record a reason for extra guests. Pick a bigger room type, or use Book to give the reason and check in from the booking."
      : null,
  run: async (draft, ctx) => {
    const amount = amountNow(draft)
    // walk_in asks for the PIN and an open till before it books anything
    if (amount > 0) await ctx.ensureUnlocked()
    const { blacklist_override_reason, credit_override_reason } = ctx.overrides
    const p = bookingParams(draft)
    const r = await call<{
      reservation: string
      room: string | null
      checked_in?: number
      paid?: number
      credit_warning?: CreditWarning
    }>("kamra.api.walk_in", {
      property: p.property,
      room_type: p.room_type,
      room: draft.room.room,
      check_out_date: p.check_out_date,
      adults: p.adults,
      children: p.children,
      guest_name: p.guest_name,
      ...(p.phone ? { phone: p.phone } : {}),
      ...(p.guest ? { guest: p.guest } : {}),
      ...(p.company ? { company: p.company } : {}),
      ...(amount > 0 ? { payment_mode: draft.payment.mode } : {}),
      payment_amount: amount,
      ...withOverrides({ blacklist_override_reason, credit_override_reason }),
      idempotency_key: ctx.keys.booking,
      defer_check_in: 1,
    })
    return {
      reservation: r.reservation,
      room: r.room ?? null,
      reservations: [r.reservation],
      paid: r.paid ?? amount,
      ...(r.credit_warning ? { credit_warning: r.credit_warning } : {}),
      // an idempotent replay answers without checked_in: check in anyway,
      // CheckInDialog shows where that booking stands
      check_in: r.checked_in !== 1,
    }
  },
}

/** The drawer's buttons, in order. */
export const SUBMIT_PATHS: SubmitPath[] = [bookOneRoom, bookAndCheckIn, bookGroup]

/** Why Kamra refused, read from the error `call` threw. `kind` sorts the
 *  refusals the desk can act on (D6 reasons, D7 till / PIN). */
export interface Refusal {
  message: string
  title: string | null
  exc_type: string | null
  kind: "blacklist" | "credit" | "capacity" | "till" | "pin" | "other"
  /** Kamra would book past it with a reason: blacklist, credit, and over
   *  capacity while the room type has extra beds left */
  reasonable: boolean
}

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
  const text = raw || message
  const kind: Refusal["kind"] =
    title === "Blacklisted guest" || /blacklisted guest/i.test(text)
      ? "blacklist"
      : exc_type === "CreditBlocked" || text.includes("CREDIT_BLOCKED")
        ? "credit"
        : title === "Over room capacity"
          ? "capacity"
          : text.includes("NO_OPEN_SESSION")
            ? "till"
            : /^PIN_|cashier PIN/.test(text)
              ? "pin"
              : "other"
  const reasonable =
    kind === "blacklist" || kind === "credit" || (kind === "capacity" && !/can't sleep|Reduce the party/.test(text))
  return { message, title, exc_type, kind, reasonable }
}

/*  The New booking drawer's booking rules, apart from any screen.

    What the steps show and what the submit paths send both follow from
    these: which day is "today" for the hotel, whether it's a Group
    booking, who pays, what the price is, the source and what is collected
    now. Steps and submit modules import them from here, so a rule lives in
    one place and the submit modules never reach into a step's UI file. */

import type { QuoteParams, Quote } from "../../lib/api"
import { todayPlus } from "../../lib/stay"
import type { RoomRow } from "./steps/MoreRooms"
import type { NewBookingDraft, StayDraft } from "./types"

// ── dates ────────────────────────────────────────────────────────────────

/** The stay a list of free rooms or a price was asked for. */
export const stayKey = (stay: StayDraft) => `${stay.check_in_date}|${stay.check_out_date}`

/** "Today" for the hotel: Kamra's business date (kamra.cashier.my_till)
 *  once it has answered, else the browser's calendar date. */
export const businessToday = (draft: Pick<NewBookingDraft, "businessDate">) =>
  draft.businessDate || todayPlus(0)

/** The stay starts on the hotel's today: a walk-in. */
export const checksInToday = (draft: NewBookingDraft) => draft.stay.check_in_date === businessToday(draft)

/** Why a room's guests can't be booked (English, for t()), or null. */
export function guestCountProblem(adults: number, children: number): string | null {
  if (!Number.isInteger(adults) || adults < 1) return "At least one adult."
  if (!Number.isInteger(children) || children < 0) return "Children can't be negative."
  return null
}

// ── rooms ────────────────────────────────────────────────────────────────

/** The rooms after the first; none for a plain Booking. */
export const extraRows = (draft: NewBookingDraft): RoomRow[] => draft.moreRooms?.rows ?? []

/** Two or more rooms: this is a Group booking. */
export const isGroup = (draft: NewBookingDraft) => extraRows(draft).length > 0

// ── who pays ─────────────────────────────────────────────────────────────

/** The company paying the room, or "" when the guest pays. */
export const payingCompany = (draft: Pick<NewBookingDraft, "payment">) =>
  draft.payment?.payer === "company" ? draft.payment.company : ""

// ── price ────────────────────────────────────────────────────────────────

/** What get_quote is asked with for the first room. A paying company
 *  prices on its negotiated plan. */
export function quoteParams(draft: NewBookingDraft): QuoteParams {
  const company = payingCompany(draft)
  return {
    room_type: draft.room.room_type,
    check_in_date: draft.stay.check_in_date,
    check_out_date: draft.stay.check_out_date,
    adults: draft.stay.adults,
    children: draft.stay.children,
    ...(company ? { company } : {}),
  }
}

/** An extra room is priced like the first, on its own type and guests. */
export const rowQuoteParams = (draft: NewBookingDraft, row: RoomRow): QuoteParams => ({
  ...quoteParams(draft),
  room_type: row.room_type,
  adults: row.adults,
  children: row.children,
})

/** The key a quote is kept under: which params it was priced on. */
export const paramsKey = (params: QuoteParams) => JSON.stringify(params)

export const quoteKey = (draft: NewBookingDraft) => paramsKey(quoteParams(draft))
export const rowQuoteKey = (draft: NewBookingDraft, row: RoomRow) => paramsKey(rowQuoteParams(draft, row))

/** The first room's quote as the booking stands now, or null (none / stale). */
export function currentQuote(draft: NewBookingDraft): Quote | null {
  const r = draft.rate
  return r?.quote && r.quotedFor === quoteKey(draft) ? r.quote : null
}

/** An extra room's quote as it stands now, or null. */
export const rowQuote = (draft: NewBookingDraft, row: RoomRow): Quote | null =>
  row.rate.quote && row.rate.quotedFor === rowQuoteKey(draft, row) ? row.rate.quote : null

/** Every room has a price for what it is now. */
export const allPriced = (draft: NewBookingDraft) =>
  currentQuote(draft) !== null && extraRows(draft).every((r) => rowQuote(draft, r) !== null)

/** The booking's total after tax (what payment collects): every room's, or
 *  null while any room has no current price. */
export function quoteTotal(draft: NewBookingDraft): number | null {
  if (!allPriced(draft)) return null
  return extraRows(draft).reduce(
    (sum, r) => sum + rowQuote(draft, r)!.amount_after_tax,
    currentQuote(draft)!.amount_after_tax,
  )
}

// ── source & payment ─────────────────────────────────────────────────────

/** Kamra's create_booking `source` values the desk can pick (D3). */
export type BookingSource = "Walk-in" | "Phone" | "Manual"

/** The booking source create_booking is sent. */
export function sourceFor(draft: NewBookingDraft): BookingSource {
  return draft.payment.source ?? (checksInToday(draft) ? "Walk-in" : "Phone")
}

/** Money is taken when the booking is made. */
export function paysNow(draft: NewBookingDraft): boolean {
  const pay = draft.payment.pay
  // a company paying the room means nothing is collected by default
  return pay ? pay === "now" : checksInToday(draft) && !payingCompany(draft)
}

/** What to collect now: 0 when paying on arrival, else the typed amount or
 *  the booking's total. NaN when the typed amount isn't a number. */
export function amountNow(draft: NewBookingDraft): number {
  if (!paysNow(draft)) return 0
  const typed = draft.payment.amount
  if (typed === null) return quoteTotal(draft) ?? 0
  return typed.trim() === "" ? NaN : Number(typed)
}

/*  Every Kamra call the New booking drawer makes, typed in one place.

    Steps and submit paths call these instead of `call("kamra.…")` with a
    method string, so the params and answers Kamra deals in are written
    down once (see the scratchpad kamra-api notes and kamra/api.py). The
    calls go through lib/api's `call` and friends, which stay as they are
    (they're upstream-owned). Each wrapper fills in the current property
    where Kamra wants one. */

import {
  call,
  getBookingOptions,
  getCurrentProperty,
  getQuote,
  guestAlert,
  guestSearch,
} from "../../lib/api"
import type { TillState } from "../TillCard"

export { getBookingOptions, getQuote, guestAlert, guestSearch }
export type { TillState }

/** One free room, as kamra.api.available_rooms lists it. */
export interface FreeRoom {
  name: string
  room_number: string
  housekeeping_status?: string
}

/** kamra.api.available_rooms: the rooms of one type free for the stay.
 *  `ready_now` leaves out rooms whose guest is still checked in. */
export const availableRooms = (p: {
  room_type: string
  check_in_date: string
  check_out_date: string
  ready_now?: boolean
}) =>
  call<FreeRoom[]>("kamra.api.available_rooms", {
    property: getCurrentProperty(),
    room_type: p.room_type,
    check_in_date: p.check_in_date,
    check_out_date: p.check_out_date,
    ...(p.ready_now ? { ready_now: 1 } : {}),
  })

/** kamra.cashier.my_till: the caller's till, and the property's business date. */
export const myTill = () => call<TillState>("kamra.cashier.my_till", { property: getCurrentProperty() })

/** kamra.credit.company_credit_status's answer (the parts the drawer reads). */
export interface CompanyCredit {
  applies: boolean
  ok: boolean
  blocked?: boolean
  policy: string
  company?: string
  reasons: string[]
  can_override?: boolean
}

/** kamra.credit.company_credit_status for `amount` on the company's account. */
export const companyCreditStatus = (company: string, amount: number) =>
  call<CompanyCredit>("kamra.credit.company_credit_status", {
    company,
    property: getCurrentProperty(),
    amount,
  })

/** The credit warning create_booking / walk_in return under Kamra's "warn"
 *  policy (or a block that was overridden). */
export interface CreditWarning {
  company: string
  reasons: string[]
  overridden: boolean
}

/** kamra.api.create_booking: one room. Params as bookingParams() builds them. */
export const createBooking = (params: Record<string, unknown>) =>
  call<{ reservation: string; room: string | null; credit_warning?: CreditWarning }>(
    "kamra.api.create_booking",
    params,
  )

/** One line of create_group_booking's `rooms`. */
export interface GroupRoomLine {
  room_type: string
  count: number
  room?: string
  adults: number
  children: number
}

/** kamra.api.create_group_booking: two or more rooms. A room Kamra refused
 *  comes back in `skipped`, not as an error. */
export const createGroupBooking = (params: {
  group_name: string
  check_in_date: string
  check_out_date: string
  rooms: GroupRoomLine[]
  guest_name: string
  phone?: string
  company?: string
}) =>
  call<{
    group_booking: string
    created: string[]
    skipped: { room_type: string; reason: string }[]
  }>("kamra.api.create_group_booking", { property: getCurrentProperty(), ...params })

/** kamra.api.walk_in: book one room today and (with defer_check_in) leave
 *  the check-in to Kamra's CheckInDialog. Takes no source or over-capacity. */
export const walkIn = (params: Record<string, unknown>) =>
  call<{
    reservation: string
    room: string | null
    checked_in?: number
    paid?: number
    credit_warning?: CreditWarning
  }>("kamra.api.walk_in", params)

/** kamra.api.record_advance: money taken before arrival (opens the folio). */
export const recordAdvance = (p: { reservation: string; amount: number; mode: string; idempotency_key: string }) =>
  call<{ folio: string; status: string }>("kamra.api.record_advance", p)

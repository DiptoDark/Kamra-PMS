/*  Book a Group booking: two or more rooms (MoreRooms) in one
    kamra.api.create_group_booking call (decision D4).

    The group is named "<guest name> · <check-in date>" (D2). Kamra's
    create_group_booking takes less than create_booking (#14): no source,
    guest id, override reasons or idempotency key, so those aren't sent, a
    refusal on one room comes back in `skipped` instead of failing the
    call, and there is no override on groups. Every line sends its adults,
    because Kamra's default is 2.

    Money taken now goes on the first room booked, through record_advance
    as for one room; it isn't taken when any room was skipped, since the
    amount was the total for every room. */

import { createGroupBooking } from "./api"
import { isReasonRefusal } from "./refusalReasons"
import { amountNow, extraRows, isGroup, payingCompany } from "./rules"
import { takeAdvance } from "./advance"
import type { BookingDone, SubmitPath } from "./submit"
import type { NewBookingDraft } from "./types"

/** D2: create_group_booking needs a name and Bedlu asks for none. */
export const groupName = (draft: NewBookingDraft) =>
  `${draft.guest.guest_name.trim()} · ${draft.stay.check_in_date}`

/** One create_group_booking line per room, the first room first. */
export function groupRooms(draft: NewBookingDraft) {
  const line = (r: { room_type: string; room: string }, adults: number, children: number) => ({
    room_type: r.room_type,
    count: 1,
    ...(r.room ? { room: r.room } : {}),
    adults,
    children,
  })
  return [
    line(draft.room, draft.stay.adults, draft.stay.children),
    ...extraRows(draft).map((r) => line(r, r.adults, r.children)),
  ]
}

/** English advice for a group room Kamra refused for a D6 reason. */
export const BOOK_ALONE =
  "Book a skipped room on its own to give a reason: groups can't take one yet."

export const bookGroup: SubmitPath = {
  key: "group",
  label: "Book",
  applies: isGroup,
  // no override on groups (#14): a room can be booked on its own with a reason
  refusalHint: (r) => (isReasonRefusal(r.message) ? BOOK_ALONE : null),
  run: async (draft, ctx) => {
    const amount = amountNow(draft)
    if (amount > 0) await ctx.ensureUnlocked()
    const company = payingCompany(draft)
    const g = draft.guest
    const r = await createGroupBooking({
      group_name: groupName(draft),
      check_in_date: draft.stay.check_in_date,
      check_out_date: draft.stay.check_out_date,
      rooms: groupRooms(draft),
      guest_name: g.guest_name.trim(),
      ...(g.phone ? { phone: g.phone } : {}),
      ...(company ? { company } : {}),
    })
    const skipped = r.skipped ?? []
    // Kamra throws when no room could be booked; should it answer with none
    // anyway, there is no booking to report: refuse with its reasons
    if (!r.created?.length)
      throw new Error(skipped.map((s) => `${s.room_type}: ${s.reason}`).join(" "))
    const done: BookingDone = {
      reservation: r.created[0],
      room: null,
      reservations: r.created,
      group_booking: r.group_booking,
      paid: 0,
      skipped,
    }
    if (amount <= 0) return done
    if (skipped.length > 0) return { ...done, payment_withheld: "rooms_skipped" }
    return takeAdvance(done, draft, amount, ctx)
  },
}

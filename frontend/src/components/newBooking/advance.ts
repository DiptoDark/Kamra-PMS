/*  Money taken now on a booking just made (one room or a Group booking).

    create_booking makes no folio, so the money goes through
    kamra.api.record_advance, which opens one and posts add_folio_payment as
    an Advance. It isn't all-or-nothing with the booking: a refusal comes
    back as `payment_error` on the booking that was made. */

import { serverError } from "../../lib/api"
import { recordAdvance } from "./api"
import type { BookingDone, SubmitContext } from "./submit"
import type { NewBookingDraft } from "./types"

export async function takeAdvance(
  done: BookingDone,
  draft: NewBookingDraft,
  amount: number,
  ctx: SubmitContext,
): Promise<BookingDone> {
  try {
    await recordAdvance({
      reservation: done.reservation,
      amount,
      mode: draft.payment.mode,
      idempotency_key: ctx.keys.payment,
    })
    return { ...done, paid: amount }
  } catch (e) {
    return { ...done, payment_error: serverError(e) }
  }
}

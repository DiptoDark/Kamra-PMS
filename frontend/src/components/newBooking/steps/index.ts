/*  The New booking steps, in the order they unlock. Each step lives in its
    own file; a ticket that builds a step replaces that file and should not
    need to touch this list (only a brand-new step adds a line here). */

import type { BookingStep } from "../types"
import { datesGuestsStep } from "./DatesGuestsStep"
import { guestStep } from "./GuestStep"
import { rateStep } from "./RateStep"
import { roomStep } from "./RoomStep"
import { sourcePaymentStep } from "./SourcePaymentStep"

export const BOOKING_STEPS: BookingStep[] = [
  datesGuestsStep,
  roomStep,
  guestStep,
  rateStep,
  sourcePaymentStep,
]

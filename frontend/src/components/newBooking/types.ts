/*  The New booking drawer's shared shapes.

    The drawer keeps one draft and a list of steps (steps/index.ts). Each
    step lives in its own file under steps/ and owns its slice of the
    draft. To add a slice, augment NewBookingDraft from the step's own
    file instead of editing this one:

      declare module "../types" {
        interface NewBookingDraft {
          room: RoomDraft
        }
      }

    and seed it in the step's `init` (see BookingStep). */

import type { ComponentType } from "react"
import type { BookingInitial } from "../../AppShell"

/** Dates & guests: the stay every later step works from. */
export interface StayDraft {
  /** YYYY-MM-DD, local */
  check_in_date: string
  check_out_date: string
  adults: number
  children: number
}

/** The whole booking as the drawer builds it. Steps add their own slices
 *  by module augmentation (see the comment at the top of this file). */
export interface NewBookingDraft {
  stay: StayDraft
  /** Kamra's business date for the property (YYYY-MM-DD), once
   *  kamra.cashier.my_till answers; unset/null = use the local date
   *  (rules.businessToday) */
  businessDate?: string | null
  /** check-in was opened on "today" (no date given, or the walk-in form)
   *  and the desk hasn't changed it: it moves to the business date when
   *  that answers */
  checkInFollowsToday?: boolean
}

export type DraftUpdate = (change: (draft: NewBookingDraft) => NewBookingDraft) => void

export interface StepProps {
  draft: NewBookingDraft
  update: DraftUpdate
}

export interface BookingStep {
  /** Stable key, e.g. "dates". Also the step section's id suffix. */
  key: string
  /** English label, translated where it is shown. */
  label: string
  /** English hint shown while the step is still locked. */
  lockedHint: string
  /** Seeds this step's slice of the draft from how the drawer was opened. */
  init?: (draft: NewBookingDraft, initial: BookingInitial) => NewBookingDraft
  /** The step is filled in well enough for the next one to unlock. */
  isComplete: (draft: NewBookingDraft) => boolean
  /** The step's body, shown once every step before it is complete. */
  Body: ComponentType<StepProps>
  /** Optional line(s) for the footer summary, above the buttons. */
  Summary?: ComponentType<StepProps>
}

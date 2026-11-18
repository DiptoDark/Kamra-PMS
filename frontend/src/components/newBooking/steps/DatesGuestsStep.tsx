/*  Step 1 · Dates & guests. Check-in and check-out are required; check-in
    is today or later and check-out after it. Guests default to Bedlu's
    1 adult, 0 children (Kamra's own dialog defaults to 2 adults).

    "Today" is Kamra's business date (rules.businessToday): the step asks
    kamra.cashier.my_till for it as the drawer opens, and until it answers
    (or if it can't) the browser's date stands in. A check-in opened on
    today follows the business date when it arrives. The walk-in form
    (BookingInitial.walkIn) always checks in today. */

import { useT } from "../../../lib/i18n"
import { addDays, nightsBetween, parseDate, todayPlus } from "../../../lib/stay"
import { myTill } from "../api"
import { Field, inputCls } from "../fields"
import { businessToday, guestCountProblem } from "../rules"
import { useKamra } from "../useKamra"
import type { BookingStep, NewBookingDraft, StayDraft, StepProps } from "../types"

/** Why the stay can't be booked yet (English, for t()), or null when it
 *  can. `today` is the hotel's (rules.businessToday). */
export function stayProblem(stay: StayDraft, today: string): string | null {
  if (!parseDate(stay.check_in_date)) return "Enter the check-in date."
  if (stay.check_in_date < today) return "Check-in can't be in the past."
  if (!parseDate(stay.check_out_date)) return "Enter the check-out date."
  if (stay.check_out_date <= stay.check_in_date) return "Check-out must be after check-in."
  return guestCountProblem(stay.adults, stay.children)
}

function count(value: string) {
  return value === "" ? NaN : Number(value)
}

/** Kamra's business date answered: keep it, and move a check-in that was
 *  opened on today onto it, keeping the nights. */
export function withBusinessDate(draft: NewBookingDraft, businessDate: string | null): NewBookingDraft {
  if (!parseDate(businessDate ?? "")) return draft
  const d = { ...draft, businessDate }
  const stay = d.stay
  if (!d.checkInFollowsToday || stay.check_in_date === businessDate) return d
  const nights = nightsBetween(stay.check_in_date, stay.check_out_date)
  return {
    ...d,
    stay: { ...stay, check_in_date: businessDate!, check_out_date: addDays(businessDate!, Math.max(1, nights)) },
  }
}

function DatesGuestsBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const stay = draft.stay
  const set = (patch: Partial<StayDraft>) =>
    update((d) => ({ ...d, stay: { ...d.stay, ...patch } }))
  const today = businessToday(draft)
  const problem = stayProblem(stay, today)

  // the hotel's business date; the browser's date stands in until it answers
  useKamra(
    myTill,
    [],
    (till) => update((d) => withBusinessDate(d, till.business_date)),
    () => {},
    0,
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Check-in")}>
          <input
            type="date"
            className={inputCls}
            min={today}
            required
            value={stay.check_in_date}
            onChange={(e) => {
              const check_in_date = e.target.value
              // keep the nights when the arrival moves, as the desk expects
              const nights = nightsBetween(stay.check_in_date, stay.check_out_date)
              update((d) => ({
                ...d,
                // the desk picked a date: it no longer follows the business date
                checkInFollowsToday: false,
                stay: {
                  ...d.stay,
                  check_in_date,
                  check_out_date: parseDate(check_in_date) ? addDays(check_in_date, nights) : stay.check_out_date,
                },
              }))
            }}
          />
        </Field>
        <Field label={t("Check-out")}>
          <input
            type="date"
            className={inputCls}
            min={parseDate(stay.check_in_date) ? addDays(stay.check_in_date, 1) : undefined}
            required
            value={stay.check_out_date}
            onChange={(e) => set({ check_out_date: e.target.value })}
          />
        </Field>
        <Field label={t("Adults")}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className={inputCls}
            value={Number.isNaN(stay.adults) ? "" : stay.adults}
            onChange={(e) => set({ adults: count(e.target.value) })}
          />
        </Field>
        <Field label={t("Children")}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            className={inputCls}
            value={Number.isNaN(stay.children) ? "" : stay.children}
            onChange={(e) => set({ children: count(e.target.value) })}
          />
        </Field>
      </div>
      <p
        aria-live="polite"
        className={problem ? "text-sm text-rose-600" : "text-sm text-zinc-500"}
      >
        {problem
          ? t(problem)
          : tn(
              nightsBetween(stay.check_in_date, stay.check_out_date),
              "{n} night",
              "{n} nights",
            )}
      </p>
    </div>
  )
}

function DatesGuestsSummary({ draft }: StepProps) {
  const { t, tn } = useT()
  const stay = draft.stay
  if (stayProblem(stay, businessToday(draft))) return null
  const nights = nightsBetween(stay.check_in_date, stay.check_out_date)
  return (
    <span>
      {t("{in} to {out}", { in: stay.check_in_date, out: stay.check_out_date })}
      {" · "}
      {tn(nights, "{n} night", "{n} nights")}
      {" · "}
      {tn(stay.adults, "{n} adult", "{n} adults")}
      {stay.children > 0 && <>{" · "}{tn(stay.children, "{n} child", "{n} children")}</>}
    </span>
  )
}

export const datesGuestsStep: BookingStep = {
  key: "dates",
  label: "Dates & guests",
  lockedHint: "",
  init: (draft: NewBookingDraft, initial) => {
    // the walk-in form checks in today, whatever date came with it
    const followsToday = Boolean(initial.walkIn) || !parseDate(initial.date)
    const check_in_date = followsToday ? todayPlus(0) : initial.date!
    const nights = Math.max(1, initial.stays ?? 1)
    return {
      ...draft,
      businessDate: null,
      checkInFollowsToday: followsToday,
      stay: {
        check_in_date,
        check_out_date: addDays(check_in_date, nights),
        adults: initial.adults ?? 1,
        children: initial.children ?? 0,
      },
    }
  },
  isComplete: (draft) => stayProblem(draft.stay, businessToday(draft)) === null,
  Body: DatesGuestsBody,
  Summary: DatesGuestsSummary,
}

/*  Step 1 · Dates & guests. Check-in and check-out are required; check-in
    is today or later and check-out after it. Guests default to Bedlu's
    1 adult, 0 children (Kamra's own dialog defaults to 2 adults). */

import { useT } from "../../../lib/i18n"
import { addDays, nightsBetween, parseDate, todayPlus } from "../../../lib/stay"
import { Field, inputCls } from "../fields"
import type { BookingStep, NewBookingDraft, StayDraft, StepProps } from "../types"

/** Why the stay can't be booked yet (English, for t()), or null when it can. */
export function stayProblem(stay: StayDraft): string | null {
  if (!parseDate(stay.check_in_date)) return "Enter the check-in date."
  if (stay.check_in_date < todayPlus(0)) return "Check-in can't be in the past."
  if (!parseDate(stay.check_out_date)) return "Enter the check-out date."
  if (stay.check_out_date <= stay.check_in_date) return "Check-out must be after check-in."
  if (!Number.isInteger(stay.adults) || stay.adults < 1) return "At least one adult."
  if (!Number.isInteger(stay.children) || stay.children < 0) return "Children can't be negative."
  return null
}

function count(value: string) {
  return value === "" ? NaN : Number(value)
}

function DatesGuestsBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const stay = draft.stay
  const set = (patch: Partial<StayDraft>) =>
    update((d) => ({ ...d, stay: { ...d.stay, ...patch } }))
  const problem = stayProblem(stay)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Check-in")}>
          <input
            type="date"
            className={inputCls}
            min={todayPlus(0)}
            required
            value={stay.check_in_date}
            onChange={(e) => {
              const check_in_date = e.target.value
              // keep the nights when the arrival moves, as the desk expects
              const nights = nightsBetween(stay.check_in_date, stay.check_out_date)
              set({
                check_in_date,
                check_out_date: parseDate(check_in_date)
                  ? addDays(check_in_date, nights)
                  : stay.check_out_date,
              })
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
  if (stayProblem(stay)) return null
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
    const check_in_date = parseDate(initial.date) ? initial.date! : todayPlus(0)
    const nights = Math.max(1, initial.stays ?? 1)
    return {
      ...draft,
      stay: {
        check_in_date,
        check_out_date: addDays(check_in_date, nights),
        adults: initial.adults ?? 1,
        children: initial.children ?? 0,
      },
    }
  },
  isComplete: (draft) => stayProblem(draft.stay) === null,
  Body: DatesGuestsBody,
  Summary: DatesGuestsSummary,
}

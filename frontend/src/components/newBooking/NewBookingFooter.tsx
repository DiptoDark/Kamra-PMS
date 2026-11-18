/*  The drawer's pinned footer: each step's summary line above the buttons.
    Buttons come from submit.ts (one per applying SubmitPath) and stay
    disabled until every step is complete. A press runs the path; Kamra's
    refusal is shown above the buttons, and a booking made reports back
    through onBooked and closes the drawer (or stays open to say the
    payment didn't go through). */

import { useState } from "react"
import { useCashierAuth } from "../../lib/cashierAuth"
import { useT } from "../../lib/i18n"
import { Button } from "../ui/button"
import {
  newSubmitKeys,
  refusalOf,
  SUBMIT_PATHS,
  type BookingDone,
  type Overrides,
  type Refusal,
  type SubmitPath,
} from "./submit"
import type { BookingStep, StepProps } from "./types"

const BIG = "h-11 min-w-24 px-5 text-base"

export function NewBookingFooter(
  props: StepProps & {
    steps: BookingStep[]
    ready: boolean
    onClose: () => void
    onBooked?: (done: BookingDone) => void
    /** defaults to SUBMIT_PATHS */
    paths?: SubmitPath[]
  },
) {
  const { t } = useT()
  const { draft, update } = props
  const { ensureUnlocked } = useCashierAuth()
  const [keys] = useState(newSubmitKeys)
  // reasons for a refusal Kamra lets the desk override (#10 fills these)
  const [overrides] = useState<Overrides>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [done, setDone] = useState<BookingDone | null>(null)
  const paths = (props.paths ?? SUBMIT_PATHS).filter((p) => p.applies(draft))

  async function submit(path: SubmitPath) {
    setBusy(path.key)
    setRefusal(null)
    try {
      const result = await path.run(draft, { keys, overrides, ensureUnlocked })
      props.onBooked?.(result)
      if (result.payment_error || result.skipped?.length) setDone(result)
      else props.onClose()
    } catch (e) {
      setRefusal(refusalOf(e))
    } finally {
      setBusy(null)
    }
  }

  if (done)
    return (
      <div className="flex w-full flex-col gap-3">
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {!!done.skipped?.length && <SkippedRooms done={done} />}
          {done.payment_error && (
            <>
              <p className="font-semibold">
                {t("Booked {reservation}, but the payment wasn't recorded.", { reservation: done.reservation })}
              </p>
              <p>{done.payment_error}</p>
              <p>{t("Take the payment from the booking.")}</p>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button className={BIG} onClick={props.onClose}>
            {t("Done")}
          </Button>
        </div>
      </div>
    )

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm text-zinc-700" aria-label={t("Summary")}>
        {props.steps.map((s) => (s.Summary ? <s.Summary key={s.key} draft={draft} update={update} /> : null))}
      </div>
      {refusal && (
        <p role="alert" className="text-sm text-rose-600">
          {refusal.message}
        </p>
      )}
      {!props.ready && (
        <p className="text-end text-xs text-zinc-500">{t("Finish every step to book.")}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" className={BIG} onClick={props.onClose} disabled={busy !== null}>
          {t("Cancel")}
        </Button>
        {paths.map((p) => (
          <Button
            key={p.key}
            className={BIG}
            disabled={!props.ready || busy !== null}
            aria-busy={busy === p.key || undefined}
            onClick={() => void submit(p)}
          >
            {t(p.label)}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** A Group booking Kamra made only in part: which rooms it skipped, and
 *  why (create_group_booking can't be overridden, #14). */
function SkippedRooms({ done }: { done: BookingDone }) {
  const { t } = useT()
  const skipped = done.skipped ?? []
  return (
    <div className="mb-1">
      <p className="font-semibold">
        {t("Booked {booked} of {total} rooms in {group}.", {
          booked: done.reservations.length,
          total: done.reservations.length + skipped.length,
          group: done.group_booking ?? done.reservation,
        })}
      </p>
      <ul className="list-disc ps-5">
        {skipped.map((s, i) => (
          <li key={i}>{t("{room_type}: {reason}", { room_type: s.room_type, reason: s.reason })}</li>
        ))}
      </ul>
    </div>
  )
}

/*  The drawer's pinned footer: each step's summary line above the buttons.
    Buttons come from submit.ts (one per applying SubmitPath) and stay
    disabled until every step is complete. A press runs the path; Kamra's
    refusal is shown above the buttons (with a reason field when the desk
    may book past it, refusalReasons.ts), and a booking made reports back
    through onBooked and closes the drawer (or stays open to say the
    payment didn't go through). */

import { useState } from "react"
import { useCashierAuth } from "../../lib/cashierAuth"
import { useT } from "../../lib/i18n"
import { Button } from "../ui/button"
import { Field, inputCls } from "./fields"
import { isReasonRefusal, reasonToAsk, type ReasonAsk } from "./refusalReasons"
import { BOOK_ALONE } from "./submitGroup"
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

const FOOTER_BUTTON_SIZE = "h-11 min-w-24 px-5 text-base"

export function NewBookingFooter(
  props: StepProps & {
    steps: BookingStep[]
    ready: boolean
    onClose: () => void
    onBooked?: (done: BookingDone) => void
    /** the booking was made and wants checking in now (BookingDone.check_in) */
    onCheckIn?: (reservation: string) => void
    /** defaults to SUBMIT_PATHS */
    paths?: SubmitPath[]
  },
) {
  const { t } = useT()
  const { draft, update } = props
  const { ensureUnlocked } = useCashierAuth()
  const [keys] = useState(newSubmitKeys)
  // reasons given for refusals Kamra lets the desk override (D6), kept for
  // every later press so a second refusal doesn't drop the first reason
  const [overrides, setOverrides] = useState<Overrides>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [refused, setRefused] = useState<{ refusal: Refusal; path: SubmitPath; ask: ReasonAsk | null } | null>(
    null,
  )
  const [reason, setReason] = useState("")
  const [done, setDone] = useState<BookingDone | null>(null)
  const paths = (props.paths ?? SUBMIT_PATHS).filter((p) => p.applies(draft))
  const blocked = props.ready
    ? paths.map((p) => p.disabledReason?.(draft)).filter((r): r is string => !!r)
    : []

  async function submit(path: SubmitPath, sent: Overrides = overrides) {
    setBusy(path.key)
    setRefused(null)
    try {
      const result = await path.run(draft, { keys, overrides: sent, ensureUnlocked })
      props.onBooked?.(result)
      if (result.payment_error || result.payment_withheld || result.skipped?.length) setDone(result)
      else if (result.check_in && props.onCheckIn) props.onCheckIn(result.reservation)
      else props.onClose()
    } catch (e) {
      const refusal = refusalOf(e)
      setReason("")
      setRefused({ refusal, path, ask: reasonToAsk(refusal, path, draft, sent) })
    } finally {
      setBusy(null)
    }
  }

  /** Retry the refused path with the reason, on the same idempotency keys. */
  function retryWithReason() {
    if (!refused?.ask) return
    const sent = { ...overrides, [refused.ask.param]: reason.trim() }
    setOverrides(sent)
    void submit(refused.path, sent)
  }

  const hint = refused && !refused.ask ? refused.path.refusalHint?.(refused.refusal) : null

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
          {done.payment_withheld === "rooms_skipped" && (
            <>
              <p>{t("Not every room was booked, so no payment was taken.")}</p>
              <p>{t("Take the payment from the booking.")}</p>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button className={FOOTER_BUTTON_SIZE} onClick={props.onClose}>
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
      {refused && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-rose-600">
          <p>{refused.refusal.message}</p>
          {hint && <p className="text-zinc-700">{t(hint)}</p>}
        </div>
      )}
      {refused?.ask && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            retryWithReason()
          }}
        >
          <Field
            label={t(refused.ask.label)}
            hint={<span className="mt-1 block text-xs text-zinc-500">{t("Required. Kamra logs it with your name.")}</span>}
          >
            <input
              className={inputCls}
              value={reason}
              placeholder={t(refused.ask.placeholder)}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" className={FOOTER_BUTTON_SIZE} disabled={!reason.trim() || busy !== null}>
              {t("Book with this reason")}
            </Button>
          </div>
        </form>
      )}
      {!props.ready && (
        <p className="text-end text-xs text-zinc-500">{t("Finish every step to book.")}</p>
      )}
      {blocked.map((r) => (
        <p key={r} className="text-end text-xs text-zinc-500">
          {t(r)}
        </p>
      ))}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" className={FOOTER_BUTTON_SIZE} onClick={props.onClose} disabled={busy !== null}>
          {t("Cancel")}
        </Button>
        {paths.map((p) => (
          <Button
            key={p.key}
            className={FOOTER_BUTTON_SIZE}
            disabled={!props.ready || busy !== null || !!p.disabledReason?.(draft)}
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
      {skipped.some((s) => isReasonRefusal(s.reason)) && <p className="mt-1">{t(BOOK_ALONE)}</p>}
    </div>
  )
}

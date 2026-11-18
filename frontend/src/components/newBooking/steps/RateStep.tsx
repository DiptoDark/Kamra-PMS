/*  Step 4 · Rate. Kamra's own price for the stay (kamra.api.get_quote),
    shown read-only: create_booking takes no rate, so the desk can't type
    one (decision D1). The quote refreshes whenever what it was priced on
    changes; until a quote answers for the current inputs the step is not
    complete, so a stale price can never reach Book. */

import { useEffect, useState } from "react"
import { getQuote, type Quote, type QuoteParams } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { fmtMoney } from "../../../lib/money"
import type { BookingStep, NewBookingDraft, StepProps } from "../types"

/** The rate slice of the draft. */
export interface RateDraft {
  /** Kamra's quote, null until one answers for `quotedFor` */
  quote: Quote | null
  /** quoteKey() of the inputs the quote was priced on */
  quotedFor: string
}

declare module "../types" {
  interface NewBookingDraft {
    rate: RateDraft
  }
}

/** What get_quote is asked with. Later steps that change the price (a
 *  company paying, per-room rows) extend this; the key follows. */
export function quoteParams(draft: NewBookingDraft): QuoteParams {
  // a paying company prices on its negotiated plan (source & payment step)
  const company = draft.payment?.payer === "company" ? draft.payment.company : ""
  return {
    room_type: draft.room.room_type,
    check_in_date: draft.stay.check_in_date,
    check_out_date: draft.stay.check_out_date,
    adults: draft.stay.adults,
    children: draft.stay.children,
    ...(company ? { company } : {}),
  }
}

export const quoteKey = (draft: NewBookingDraft) => JSON.stringify(quoteParams(draft))

/** The quote for the booking as it stands now, or null (none yet / stale). */
export function currentQuote(draft: NewBookingDraft): Quote | null {
  const r = draft.rate
  return r?.quote && r.quotedFor === quoteKey(draft) ? r.quote : null
}

/** The booking's total after tax (what payment collects), or null. */
export const quoteTotal = (draft: NewBookingDraft) => currentQuote(draft)?.amount_after_tax ?? null

const DEBOUNCE_MS = 250

function RateBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const key = quoteKey(draft)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const quote = currentQuote(draft)

  useEffect(() => {
    if (currentQuote(draft)) return
    let live = true
    setError(null)
    const timer = setTimeout(() => {
      getQuote(JSON.parse(key) as QuoteParams)
        .then((q) => {
          if (!live) return
          // only keep it if the booking is still what it was priced on
          update((d) => (quoteKey(d) === key ? { ...d, rate: { quote: q, quotedFor: key } } : d))
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error && e.message ? e.message : t("Couldn't get the price."))
        })
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // the inputs are all in `key`; `draft`/`update` change every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  if (error)
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
        <button
          type="button"
          className="text-sm font-medium text-brand-600 underline"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {t("Try again")}
        </button>
      </div>
    )

  if (!quote) return <p className="text-sm text-zinc-500">{t("Getting the price…")}</p>

  const rates = quote.nightly.map((n) => n.rate)
  const flat = rates.length > 0 && rates.every((r) => r === rates[0])
  const Row = (props: { label: string; value: string; strong?: boolean }) => (
    <div className={props.strong ? "flex justify-between font-semibold" : "flex justify-between"}>
      <span>{props.label}</span>
      <span className="tabular-nums">{props.value}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      <div aria-label={t("Price")} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 text-sm">
        {flat ? (
          <p className="text-zinc-500">
            {tn(rates.length, "{rate} × {n} night", "{rate} × {n} nights", {
              rate: fmtMoney(rates[0]),
            })}
          </p>
        ) : (
          quote.nightly.map((n) => <Row key={n.date} label={n.date} value={fmtMoney(n.rate)} />)
        )}
        <Row label={t("Room")} value={fmtMoney(quote.room_total)} />
        {quote.meal_total > 0 && <Row label={t("Meals")} value={fmtMoney(quote.meal_total)} />}
        {quote.discount > 0 && <Row label={t("Discount")} value={`−${fmtMoney(quote.discount)}`} />}
        {quote.tax_amount > 0 && (
          <Row label={t("Tax ({percent}%)", { percent: quote.tax_percent })} value={fmtMoney(quote.tax_amount)} />
        )}
        <Row label={t("Total")} value={fmtMoney(quote.amount_after_tax)} strong />
      </div>
      <p className="text-xs text-zinc-500">{t("Priced by Kamra for these dates and guests.")}</p>
    </div>
  )
}

function RateSummary({ draft }: StepProps) {
  const { t, tn } = useT()
  const quote = currentQuote(draft)
  if (!quote) return null
  return (
    <span className="font-medium">
      {tn(quote.nights, "{n} night", "{n} nights")}
      {" · "}
      {t("Total {amount}", { amount: fmtMoney(quote.amount_after_tax) })}
    </span>
  )
}

export const rateStep: BookingStep = {
  key: "rate",
  label: "Rate",
  lockedHint: "Choose the guest first.",
  init: (draft) => ({ ...draft, rate: { quote: null, quotedFor: "" } }),
  isComplete: (draft) => currentQuote(draft) !== null,
  Body: RateBody,
  Summary: RateSummary,
}

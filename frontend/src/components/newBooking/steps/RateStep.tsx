/*  Step 4 · Rate. Kamra's own price for the stay (kamra.api.get_quote),
    shown read-only: create_booking takes no rate, so the desk can't type
    one (decision D1). The quote refreshes whenever what it was priced on
    changes; until a quote answers for the current inputs the step is not
    complete, so a stale price can never reach Book.

    A Group booking (MoreRooms) is priced room by room, each on its own
    room type and guests; the total is their sum. */

import { useEffect, useState } from "react"
import { getQuote, type Quote, type QuoteParams } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { fmtMoney } from "../../../lib/money"
import type { BookingStep, NewBookingDraft, StepProps } from "../types"
import { extraRows, isGroup, type RoomRow } from "./MoreRooms"

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

/** The quote for the booking as it stands now, or null (none yet / stale).
 *  For a Group booking this is the first room's. */
export function currentQuote(draft: NewBookingDraft): Quote | null {
  const r = draft.rate
  return r?.quote && r.quotedFor === quoteKey(draft) ? r.quote : null
}

/** An extra room is priced like the first, on its own type and guests. */
export const rowQuoteKey = (draft: NewBookingDraft, row: RoomRow) =>
  quoteKey({
    ...draft,
    room: { ...draft.room, room_type: row.room_type },
    stay: { ...draft.stay, adults: row.adults, children: row.children },
  })

/** An extra room's quote as it stands now, or null. */
export const rowQuote = (draft: NewBookingDraft, row: RoomRow): Quote | null =>
  row.rate.quote && row.rate.quotedFor === rowQuoteKey(draft, row) ? row.rate.quote : null

/** Every room has a price for what it is now. */
const allPriced = (draft: NewBookingDraft) =>
  currentQuote(draft) !== null && extraRows(draft).every((r) => rowQuote(draft, r) !== null)

/** The booking's total after tax (what payment collects): every room's, or
 *  null while any room has no current price. */
export function quoteTotal(draft: NewBookingDraft): number | null {
  if (!allPriced(draft)) return null
  return extraRows(draft).reduce(
    (sum, r) => sum + rowQuote(draft, r)!.amount_after_tax,
    currentQuote(draft)!.amount_after_tax,
  )
}

const DEBOUNCE_MS = 250

/** Asks get_quote for `key` unless `fresh`, and hands the answer to save. */
function useQuote(key: string, fresh: boolean, save: (q: Quote, key: string) => void) {
  const { t } = useT()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (fresh) return
    let live = true
    setError(null)
    const timer = setTimeout(() => {
      getQuote(JSON.parse(key) as QuoteParams)
        .then((q) => live && save(q, key))
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error && e.message ? e.message : t("Couldn't get the price."))
        })
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // the inputs are all in `key`; `save` changes every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  return { error, retry: () => setAttempt((n) => n + 1) }
}

function Row(props: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={props.strong ? "flex justify-between font-semibold" : "flex justify-between"}>
      <span>{props.label}</span>
      <span className="tabular-nums">{props.value}</span>
    </div>
  )
}

function Refused(props: { error: string; retry: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-sm text-rose-600">
        {props.error}
      </p>
      <button type="button" className="text-sm font-medium text-brand-600 underline" onClick={props.retry}>
        {t("Try again")}
      </button>
    </div>
  )
}

/** One room's line in a Group booking's price. */
function RoomPrice(props: { label: string; quote: Quote | null; error: string | null; retry: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-1">
      <Row
        label={props.label}
        value={props.quote ? fmtMoney(props.quote.amount_after_tax) : props.error ? "" : t("Getting the price…")}
      />
      {props.error && <Refused error={props.error} retry={props.retry} />}
    </div>
  )
}

/** An extra room's line: prices the row and keeps the answer on it. */
function RowPrice({ draft, update, row, n }: StepProps & { row: RoomRow; n: number }) {
  const { t } = useT()
  const quote = rowQuote(draft, row)
  const { error, retry } = useQuote(rowQuoteKey(draft, row), quote !== null, (q, key) =>
    update((d) => ({
      ...d,
      moreRooms: {
        ...d.moreRooms,
        // only keep it if the room is still what it was priced on
        rows: d.moreRooms.rows.map((r) =>
          r.id === row.id && rowQuoteKey(d, r) === key ? { ...r, rate: { quote: q, quotedFor: key } } : r,
        ),
      },
    })),
  )
  return (
    <RoomPrice
      label={t("Room {n} · {type}", { n, type: row.room_type_name })}
      quote={quote}
      error={error}
      retry={retry}
    />
  )
}

function RateBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const quote = currentQuote(draft)
  const { error, retry } = useQuote(quoteKey(draft), quote !== null, (q, key) =>
    // only keep it if the booking is still what it was priced on
    update((d) => (quoteKey(d) === key ? { ...d, rate: { quote: q, quotedFor: key } } : d)),
  )

  if (isGroup(draft)) {
    const total = quoteTotal(draft)
    return (
      <div className="flex flex-col gap-2">
        <div aria-label={t("Price")} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 text-sm">
          <RoomPrice
            label={t("Room {n} · {type}", { n: 1, type: draft.room.room_type_name })}
            quote={quote}
            error={error}
            retry={retry}
          />
          {extraRows(draft).map((row, i) => (
            <RowPrice key={row.id} draft={draft} update={update} row={row} n={i + 2} />
          ))}
          {total !== null && <Row label={t("Total")} value={fmtMoney(total)} strong />}
        </div>
        <p className="text-xs text-zinc-500">{t("Priced by Kamra for these dates, each room on its own guests.")}</p>
      </div>
    )
  }

  if (error) return <Refused error={error} retry={retry} />

  if (!quote) return <p className="text-sm text-zinc-500">{t("Getting the price…")}</p>

  const rates = quote.nightly.map((n) => n.rate)
  const flat = rates.length > 0 && rates.every((r) => r === rates[0])

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
  const total = quoteTotal(draft)
  if (total === null) return null
  const quote = currentQuote(draft)!
  const line = (
    <span className="font-medium">
      {tn(quote.nights, "{n} night", "{n} nights")}
      {" · "}
      {t("Total {amount}", { amount: fmtMoney(total) })}
    </span>
  )
  if (!isGroup(draft)) return line
  return (
    <span className="flex flex-col gap-0.5">
      <Row
        label={t("Room {n} · {type}", { n: 1, type: draft.room.room_type_name })}
        value={fmtMoney(quote.amount_after_tax)}
      />
      {extraRows(draft).map((row, i) => (
        <Row
          key={row.id}
          label={t("Room {n} · {type}", { n: i + 2, type: row.room_type_name })}
          value={fmtMoney(rowQuote(draft, row)!.amount_after_tax)}
        />
      ))}
      {line}
    </span>
  )
}

export const rateStep: BookingStep = {
  key: "rate",
  label: "Rate",
  lockedHint: "Choose the guest first.",
  init: (draft) => ({ ...draft, rate: { quote: null, quotedFor: "" } }),
  isComplete: allPriced,
  Body: RateBody,
  Summary: RateSummary,
}

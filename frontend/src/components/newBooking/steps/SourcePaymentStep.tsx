/*  Step 5 · Booking source & payment.

    Booking source is Walk-in · Phone · Direct (stored as Kamra's "Manual"),
    decision D3, preselected from the stay until the desk picks one.
    Payment is now or on arrival (now by default when check-in is today):
    an amount (the total unless typed) and a way to pay. */

import { useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import type { BookingOptions } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { fmtMoney, useLocale } from "../../../lib/money"
import { cn } from "../../../lib/utils"
import TillCard from "../../TillCard"
import { Button } from "../../ui/button"
import { companyCreditStatus, getBookingOptions, myTill, type CompanyCredit, type TillState } from "../api"
import { Field, inputCls } from "../fields"
import {
  amountNow,
  checksInToday,
  isGroup,
  payingCompany,
  paysNow,
  quoteTotal,
  sourceFor,
  type BookingSource,
} from "../rules"
import type { BookingStep, NewBookingDraft, StepProps } from "../types"
import { useKamra } from "../useKamra"

export type { BookingSource, CompanyCredit }

export interface PaymentDraft {
  /** the source the desk picked, null = the default (sourceFor) */
  source: BookingSource | null
  /** collect now or on arrival as the desk picked, null = the default (paysNow) */
  pay: "now" | "arrival" | null
  /** the amount to collect as typed, null = the booking's total */
  amount: string | null
  /** payment mode, one of the property's payment_modes ("" until they load) */
  mode: string
  /** who pays the room: the guest, or a company (Corporate Account) */
  payer: "guest" | "company"
  /** the Corporate Account name when the company pays, else "" */
  company: string
  /** its display name */
  company_name: string
  /** kamra.credit.company_credit_status for `creditFor`, null when it failed */
  credit: CompanyCredit | null
  /** creditKey() the credit answer is for, "" until one answers */
  creditFor: string
  /** the clerk's till (kamra.cashier.my_till), asked when collecting now;
   *  null until it answers */
  till: TillState | null
  /** my_till failed: the till's state is unknown, so nothing is collected
   *  until it answers (D7) */
  tillUnknown?: boolean
}

declare module "../types" {
  interface NewBookingDraft {
    payment: PaymentDraft
  }
}

/** What the credit check was asked for: the company and the total. */
const creditKey = (draft: NewBookingDraft) => `${payingCompany(draft)}|${quoteTotal(draft) ?? ""}`

const SOURCES: { value: BookingSource; label: string }[] = [
  { value: "Walk-in", label: "Walk-in" },
  { value: "Phone", label: "Phone" },
  { value: "Manual", label: "Direct" },
]

/** A row of radio buttons styled as a segmented control. */
function Segmented<V extends string>(props: {
  label: string
  name: string
  value: V
  options: { value: V; label: string }[]
  onChange: (v: V) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-zinc-600">{props.label}</legend>
      <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5">
        {props.options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-md px-3.5 py-2 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600",
              props.value === o.value ? "bg-brand-600 text-white" : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function SourcePaymentBody({ draft, update }: StepProps) {
  const { t } = useT()
  const p = draft.payment
  const set = (patch: Partial<PaymentDraft>) =>
    update((d) => ({ ...d, payment: { ...d.payment, ...patch } }))
  const source = sourceFor(draft)
  const sourceLabel = SOURCES.find((s) => s.value === source)!.label
  const now = paysNow(draft)
  const modes = useLocale().payment_modes

  // the first way to pay is the default once the property's list loads
  useEffect(() => {
    if (!p.mode && modes.length) set({ mode: modes[0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mode, modes])

  // D7: money is only taken through an open till, so ask before Book (the
  // advance after create_booking isn't all-or-nothing with the booking)
  const [tillAsk, setTillAsk] = useState(0)
  useKamra(
    now ? myTill : null,
    [now, tillAsk],
    (till) => set({ till, tillUnknown: false }),
    () => set({ till: null, tillUnknown: true }),
    0,
  )
  const tillClosed = now && p.till !== null && !p.till.open
  const tillUnknown = now && p.till === null && Boolean(p.tillUnknown)
  const amount = amountNow(draft)

  // the companies the desk can bill (booking_options)
  const [companies, setCompanies] = useState<BookingOptions["companies"]>([])
  useKamra(
    getBookingOptions,
    [],
    (o) => setCompanies(o?.companies ?? []),
    () => setCompanies([]),
    0,
  )

  // the credit check create_booking runs, asked up front for the total
  const company = payingCompany(draft)
  const total = quoteTotal(draft)
  const creditAskedFor = creditKey(draft)
  useKamra(
    !company || total === null || p.creditFor === creditAskedFor
      ? null
      : () => companyCreditStatus(company, total),
    [creditAskedFor],
    (credit) => set({ credit, creditFor: creditAskedFor }),
    // the server checks again on Book; don't hold the desk up here
    () => set({ credit: null, creditFor: creditAskedFor }),
  )
  const credit = company && p.creditFor === creditAskedFor ? p.credit : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Segmented
          label={t("Booking source")}
          name="nb-source"
          value={source}
          options={SOURCES.map((s) => ({ value: s.value, label: t(s.label) }))}
          onChange={(v) => set({ source: v })}
        />
        <p className="mt-1.5 text-xs text-zinc-500">
          {p.source
            ? t("Required on every booking.")
            : checksInToday(draft)
              ? t("Set to {source} because check-in is today. Change it if that's wrong.", {
                  source: t(sourceLabel),
                })
              : t("Set to {source} because check-in is a later date. Change it if that's wrong.", {
                  source: t(sourceLabel),
                })}
        </p>
        {/* create_group_booking doesn't pass the source on (#14) */}
        {isGroup(draft) && (
          <p className="mt-1 text-xs text-amber-700">
            {t("Kamra records a Group booking's rooms as Direct for now, whatever is picked here.")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Segmented
          label={t("Who pays the room")}
          name="nb-payer"
          value={p.payer}
          options={[
            { value: "guest", label: t("Guest pays") },
            { value: "company", label: t("Company pays") },
          ]}
          onChange={(v) => set({ payer: v })}
        />
        {p.payer === "company" && (
          <Field label={t("Company")}>
            <select
              className={inputCls}
              value={p.company}
              onChange={(e) => {
                const c = companies.find((x) => x.name === e.target.value)
                set({ company: c?.name ?? "", company_name: c?.company_name ?? "" })
              }}
            >
              <option value="">{t("Choose the company")}</option>
              {companies.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {credit && credit.applies && !credit.ok && (
          <div
            role="alert"
            className={cn(
              "flex items-start gap-2 rounded-xl px-4 py-3 text-sm",
              credit.blocked
                ? "border-2 border-rose-300 bg-rose-50 text-rose-800"
                : "border border-amber-300 bg-amber-50 text-amber-900",
            )}
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                {credit.blocked
                  ? t("{company}: company credit is blocked", { company: credit.company ?? p.company_name })
                  : t("{company}: company credit warning", { company: credit.company ?? p.company_name })}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4">
                {credit.reasons.map((r) => (
                  <li key={r}>{t(r)}</li>
                ))}
              </ul>
              {credit.blocked && (
                <p className="mt-1">{t("Kamra will refuse this booking unless the block is overridden.")}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <Segmented
            label={t("Payment")}
            name="nb-pay"
            value={now ? "now" : "arrival"}
            options={[
              { value: "arrival", label: t("On arrival") },
              { value: "now", label: t("Collect now") },
            ]}
            onChange={(v) => set({ pay: v })}
          />
          {!p.pay && (
            <p className="mt-1.5 text-xs text-zinc-500">
              {now
                ? t("Collect now because the guest is checking in today.")
                : company
                  ? t("{company} pays the room, so nothing is collected now.", { company: p.company_name })
                  : t("Paid when the guest arrives.")}
            </p>
          )}
        </div>
        {tillUnknown && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-amber-800">
              {t("Couldn't check your till, so money can't be taken now.")}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTillAsk((n) => n + 1)}>
                {t("Try again")}
              </Button>
              <Button variant="outline" onClick={() => set({ pay: "arrival" })}>
                {t("Pay on arrival")}
              </Button>
            </div>
          </div>
        )}
        {tillClosed && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-amber-800">
              {t("Your till is closed, so money can't be taken now.")}
            </p>
            <TillCard till={p.till} onOpened={() => setTillAsk((n) => n + 1)} purpose={t("to take the payment")} />
            <Button variant="outline" onClick={() => set({ pay: "arrival" })}>
              {t("Pay on arrival")}
            </Button>
          </div>
        )}
        {now && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Amount")}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className={inputCls}
                value={p.amount ?? String(quoteTotal(draft) ?? "")}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </Field>
            <Field label={t("Method")}>
              <select className={inputCls} value={p.mode} onChange={(e) => set({ mode: e.target.value })}>
                {!p.mode && <option value="">{t("Loading…")}</option>}
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {t(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {now && !(amount > 0) && <p className="text-xs text-rose-600">{t("Enter the amount to collect.")}</p>}
      </div>
    </div>
  )
}

function SourcePaymentSummary({ draft }: StepProps) {
  const { t } = useT()
  const total = quoteTotal(draft)
  if (total === null) return null
  const amount = amountNow(draft)
  const company = payingCompany(draft)
  let line: string
  if (paysNow(draft) && amount > 0)
    line =
      amount < total
        ? t("Collect now {amount} · {rest} later", { amount: fmtMoney(amount), rest: fmtMoney(total - amount) })
        : t("Collect now {amount}", { amount: fmtMoney(amount) })
  else if (company) line = t("{company} pays", { company: draft.payment.company_name })
  else line = t("Pay on arrival")
  return <span>{line}</span>
}

export const sourcePaymentStep: BookingStep = {
  key: "payment",
  label: "Source & payment",
  lockedHint: "Check the rate first.",
  init: (draft, initial) => ({
    ...draft,
    payment: {
      // the walk-in form (AgentGuide): a walk-in, paying now
      source: initial.walkIn ? "Walk-in" : null,
      pay: initial.walkIn ? "now" : null,
      amount: null,
      mode: "",
      payer: "guest",
      company: "",
      company_name: "",
      credit: null,
      creditFor: "",
      till: null,
      tillUnknown: false,
    },
  }),
  isComplete: (draft) => {
    const p = draft.payment
    // a company paying must be picked, and its credit asked for this total
    if (p.payer === "company" && (!p.company || p.creditFor !== creditKey(draft))) return false
    if (!paysNow(draft)) return true
    return amountNow(draft) > 0 && Boolean(p.mode) && Boolean(p.till?.open)
  },
  Body: SourcePaymentBody,
  Summary: SourcePaymentSummary,
}

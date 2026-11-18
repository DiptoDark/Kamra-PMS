/*  Step 3 · Guest. Find a returning guest (kamra.api.guest_search) or enter
    a new one: name required, phone optional (but complete when given).
    Either way the step hands on `guest_name` + `phone`, and `guest` when an
    existing profile was picked (create_booking wants guest_name even then).

    Alerts for the profile the booking would attach to come from
    kamra.api.guest_alert: the picked profile, else the profile with the new
    guest's phone. The answer is kept on the draft (`guest.alert`) so the
    booking step can ask for blacklist_override_reason when the server
    allows it (`can_override`), per D6. */

import { useEffect, useState } from "react"
import { ShieldAlert, Star, X } from "lucide-react"
import type { GuestAlert, GuestHit } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { isPhoneComplete } from "../../../lib/phone"
import PhoneInput from "../../PhoneInput"
import { getBookingOptions, guestAlert, guestSearch } from "../api"
import { Field, inputCls } from "../fields"
import type { BookingStep, NewBookingDraft, StepProps } from "../types"
import { useKamra } from "../useKamra"

/** The guest the booking is for. */
export interface GuestDraft {
  /** "find": searching existing guests; "new": typing a new guest. */
  entry: "find" | "new"
  /** The existing Guest profile picked, or null for a new guest. */
  guest: string | null
  guest_name: string
  /** Fully qualified (+880...), or "" when not given. */
  phone: string
  /** The picked profile, for showing it (stays, VIP). */
  profile: GuestHit | null
  /** guest_alert's answer for this guest, null until asked / nothing to ask. */
  alert: GuestAlert | null
}

declare module "../types" {
  interface NewBookingDraft {
    guest: GuestDraft
  }
}

const emptyGuest: GuestDraft = {
  entry: "find",
  guest: null,
  guest_name: "",
  phone: "",
  profile: null,
  alert: null,
}

/** The property's country, for PhoneInput's default calling code. */
let countryCache: Promise<string | null> | null = null
function useCountry() {
  const [country, setCountry] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    countryCache ??= getBookingOptions()
      .then((o) => o?.property?.country ?? null)
      .catch(() => {
        countryCache = null
        return null
      })
    countryCache.then((c) => live && setCountry(c))
    return () => {
      live = false
    }
  }, [])
  return country
}

/** For tests: forget the cached country between renders. */
export function resetGuestStepCache() {
  countryCache = null
}

function GuestBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const g = draft.guest
  const country = useCountry()
  const set = (patch: Partial<GuestDraft>) =>
    update((d) => ({ ...d, guest: { ...d.guest, ...patch } }))

  // Ask the server about the guest this booking would attach to.
  const phoneToCheck =
    !g.guest && g.entry === "new" && g.phone && isPhoneComplete(g.phone, country) ? g.phone : ""
  const nothingToCheck = !g.guest && !phoneToCheck
  useEffect(() => {
    if (nothingToCheck && g.alert) set({ alert: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingToCheck])
  useKamra(
    nothingToCheck ? null : () => guestAlert(g.guest ? { guest: g.guest } : { phone: phoneToCheck }),
    [g.guest, phoneToCheck],
    (alert) => set({ alert }),
    () => set({ alert: null }),
  )

  const alertBox = g.alert && Boolean(g.alert.blacklisted) && (
    <div
      role="alert"
      className="space-y-1 rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      <p className="flex items-start gap-2 font-semibold">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden />
        {g.alert.full_name
          ? t("{name} is blacklisted", { name: g.alert.full_name })
          : t("This guest is blacklisted")}
      </p>
      {g.alert.blacklist_reason && <p>{g.alert.blacklist_reason}</p>}
      <p>
        {g.alert.can_override
          ? t("You can still book them: you'll be asked for a reason, which is logged.")
          : t("Only a Hotel Admin can book a blacklisted guest.")}
      </p>
    </div>
  )

  if (g.guest) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-medium">
              {g.guest_name}
              {Boolean(g.profile?.vip) && (
                <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label={t("VIP")} />
              )}
            </p>
            <p className="text-sm text-zinc-500">
              {[g.phone, g.profile?.stays ? tn(g.profile.stays, "{n} past booking", "{n} past bookings") : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
            onClick={() => set(emptyGuest)}
          >
            <X className="size-3.5" aria-hidden />
            {t("Change guest")}
          </button>
        </div>
        {alertBox}
      </div>
    )
  }

  if (g.entry === "new") {
    const nameMissing = !g.guest_name.trim()
    const phoneBad = !isPhoneComplete(g.phone, country)
    return (
      <div className="flex flex-col gap-3">
        <Field label={t("Full name")}>
          <input
            className={inputCls}
            value={g.guest_name}
            autoComplete="off"
            required
            onChange={(e) => set({ guest_name: e.target.value })}
          />
        </Field>
        {nameMissing && <p className="text-sm text-zinc-500">{t("Enter the guest's name.")}</p>}
        <Field label={t("Phone")}>
          <PhoneInput value={g.phone} country={country} onChange={(phone) => set({ phone })} />
        </Field>
        {phoneBad && <p className="text-sm text-rose-600">{t("Finish the phone number, or clear it.")}</p>}
        {alertBox}
        <button
          type="button"
          className="self-start text-sm text-brand-700 hover:underline"
          onClick={() => set(emptyGuest)}
        >
          {t("Search existing guests instead")}
        </button>
      </div>
    )
  }

  return <GuestSearch draft={draft} update={update} />
}

function GuestSearch({ update }: StepProps) {
  const { t, tn } = useT()
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<GuestHit[] | null>(null)
  const query = q.trim()

  const tooShort = query.length < 2
  useEffect(() => {
    if (tooShort) setHits(null)
  }, [tooShort, query])
  useKamra(
    tooShort ? null : () => guestSearch(query),
    [query],
    setHits,
    () => setHits([]),
  )

  const pick = (h: GuestHit) =>
    update((d) => ({
      ...d,
      guest: {
        ...emptyGuest,
        guest: h.name,
        guest_name: h.full_name,
        phone: h.phone ?? "",
        profile: h,
      },
    }))
  // A typed name carries over to the new-guest form; a typed number does not
  // (it still needs its calling code, which PhoneInput adds).
  const startNew = () =>
    update((d) => ({
      ...d,
      guest: { ...emptyGuest, entry: "new", guest_name: /\d/.test(query) ? "" : query },
    }))

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("Find a guest")}>
        <input
          type="search"
          className={inputCls}
          value={q}
          autoComplete="off"
          placeholder={t("Name or phone")}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <p className="text-sm text-zinc-500">
        {t("Returning guests appear as you type. A name or phone number works.")}
      </p>
      {hits && (
        <div role="listbox" aria-label={t("Matching guests")} className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {hits.length === 0 && (
            <p className="px-3 py-2 text-sm text-zinc-500">{t("No guest matches.")}</p>
          )}
          {hits.map((h) => (
            <button
              key={h.name}
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
              onClick={() => pick(h)}
            >
              <span className="font-medium">{h.full_name}</span>
              {Boolean(h.blacklisted) && (
                <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                  {t("Blacklisted")}
                </span>
              )}
              {Boolean(h.vip) && (
                <Star className="size-3 fill-amber-400 text-amber-400" aria-label={t("VIP")} />
              )}
              <span className="ml-auto text-xs text-zinc-400">
                {h.phone ? `${h.phone} · ` : ""}
                {tn(h.stays, "{n} past booking", "{n} past bookings")}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="self-start text-sm font-medium text-brand-700 hover:underline"
        onClick={startNew}
      >
        {query && !/\d/.test(query)
          ? t("+ New guest “{name}”", { name: query })
          : t("+ New guest")}
      </button>
    </div>
  )
}

function GuestSummary({ draft }: StepProps) {
  if (!guestStep.isComplete(draft)) return null
  return <span>{draft.guest.guest_name.trim()}</span>
}

/** A picked profile, or a new guest with a name and a complete (or no) phone. */
export function guestReady(g: GuestDraft | undefined): boolean {
  if (!g) return false
  if (g.guest) return true
  return g.entry === "new" && g.guest_name.trim().length > 0 && isPhoneComplete(g.phone)
}

export const guestStep: BookingStep = {
  key: "guest",
  label: "Guest",
  lockedHint: "Choose a room type first.",
  init: (draft: NewBookingDraft, initial) => ({
    ...draft,
    guest: initial.guest
      ? {
          ...emptyGuest,
          guest: initial.guest,
          guest_name: initial.guest_name ?? "",
          phone: initial.phone ?? "",
        }
      : initial.guest_name
        ? { ...emptyGuest, entry: "new", guest_name: initial.guest_name, phone: initial.phone ?? "" }
        : emptyGuest,
  }),
  isComplete: (draft) => guestReady(draft.guest),
  Body: GuestBody,
  Summary: GuestSummary,
}

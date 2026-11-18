import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewBookingFooter } from "./NewBookingFooter"
import type { NewBookingDraft } from "./types"

// D6 (#10): when Kamra refuses a booking it lets some roles override, the
// footer asks for the reason inline and retries with the same keys.

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  ...api,
}))

const TODAY = "2026-11-18"

type Patch = {
  stay?: Partial<NewBookingDraft["stay"]>
  room?: Partial<NewBookingDraft["room"]>
  guest?: Partial<NewBookingDraft["guest"]>
  payment?: Partial<NewBookingDraft["payment"]>
  moreRooms?: NewBookingDraft["moreRooms"]
}

const draftWith = (p: Patch = {}): NewBookingDraft => ({
  stay: { check_in_date: "2026-11-25", check_out_date: "2026-11-27", adults: 3, children: 0, ...p.stay },
  room: { room_type: "Deluxe", room_type_name: "Deluxe King", room: "R-204", free: [], freeFor: "", ...p.room },
  moreRooms: p.moreRooms ?? { rows: [], free: null, freeFor: "" },
  guest: {
    entry: "find",
    guest: "G-0007",
    guest_name: "Rahim Uddin",
    phone: "",
    profile: null,
    alert: null,
    ...p.guest,
  },
  rate: { quote: null, quotedFor: "" },
  payment: {
    source: "Manual",
    pay: "arrival",
    amount: null,
    mode: "Cash",
    payer: "guest",
    company: "",
    company_name: "",
    credit: null,
    creditFor: "",
    till: null,
    ...p.payment,
  },
})

/** A Frappe error the way lib/api throws it: message plus raw body. */
function frappeError(message: string, title: string, exc_type = "ValidationError") {
  return Object.assign(new Error(message), {
    status: 417,
    body: JSON.stringify({
      exc_type,
      _server_messages: JSON.stringify([JSON.stringify({ message, title })]),
    }),
  })
}

const BLACKLISTED = () =>
  frappeError(
    "Guest Rahim Uddin is blacklisted — Damaged the room. Remove the flag on the guest profile to book.",
    "Blacklisted guest",
  )
const CREDIT_BLOCKED = () =>
  frappeError(
    "CREDIT_BLOCKED: Acme: Over the credit limit. Credit control blocks this booking. Finance or a Hotel Admin can override it with a reason.",
    "Company credit",
    "CreditBlocked",
  )
const OVER_CAPACITY = () =>
  frappeError(
    "Deluxe King sleeps 2. Up to 1 more can be booked by arrangement - give a reason on the booking to record who agreed it.",
    "Over room capacity",
  )
const CANT_SLEEP = () =>
  frappeError(
    "Deluxe King can't sleep 4 adults (max 3). Reduce the party, pick a bigger room type, or book additional rooms — use a Group Booking for large parties.",
    "Over room capacity",
  )

const blacklistedGuest = (can_override: 0 | 1): Patch["guest"] => ({
  alert: { guest: "G-0007", full_name: "Rahim Uddin", blacklisted: 1, blacklist_reason: "Damaged the room", can_override },
})
const blockedCompany = (can_override: boolean): Patch["payment"] => ({
  payer: "company",
  company: "Acme",
  company_name: "Acme Ltd",
  credit: { applies: true, ok: false, blocked: true, policy: "block", company: "Acme", reasons: ["Over the credit limit"], can_override },
})

/** Kamra answers each call with the next item: an Error is thrown. */
function kamra(method: string, ...answers: unknown[]) {
  api.call.mockImplementation(async (m: string) => {
    if (m !== method) throw new Error(`unexpected call ${m}`)
    const next = answers.length > 1 ? answers.shift() : answers[0]
    if (next instanceof Error) throw next
    return next
  })
}

const calls = (method: string) =>
  api.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>)

function open(draft: NewBookingDraft) {
  const onBooked = vi.fn()
  const onClose = vi.fn()
  render(
    <NewBookingFooter draft={draft} update={() => {}} steps={[]} ready onClose={onClose} onBooked={onBooked} />,
  )
  return { onBooked, onClose }
}

const booked = { reservation: "RES-0042", room: "R-204" }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Book (one room) after Kamra refuses", () => {
  it("asks an admin why they're booking a blacklisted guest, then retries with that reason and the same key", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", BLACKLISTED(), booked)
    const { onBooked } = open(draftWith({ guest: blacklistedGuest(1) }))

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("is blacklisted")
    await user.type(screen.getByLabelText(/Reason for booking a blacklisted guest/), "Owner vouched for him")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    const [first, retry] = calls("kamra.api.create_booking")
    expect(first.blacklist_override_reason).toBeUndefined()
    expect(retry.blacklist_override_reason).toBe("Owner vouched for him")
    expect(retry.idempotency_key).toBe(first.idempotency_key)
  })
})

describe("Book (one room) refusals, by role and reason", () => {
  it("doesn't offer a blacklist override to a role Kamra won't let override", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", BLACKLISTED())
    open(draftWith({ guest: blacklistedGuest(0) }))

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("is blacklisted")
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: "Book with this reason" })).toBeNull()
  })

  it("asks Finance why they're booking past a company's credit block", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", CREDIT_BLOCKED(), booked)
    const { onBooked } = open(draftWith({ payment: blockedCompany(true) }))

    await user.click(screen.getByRole("button", { name: "Book" }))
    await user.type(await screen.findByLabelText(/Reason for booking past the credit limit/), "GM approved")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(calls("kamra.api.create_booking")[1].credit_override_reason).toBe("GM approved")
  })

  it("doesn't offer a credit override to a role Kamra won't let override", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", CREDIT_BLOCKED())
    open(draftWith({ payment: blockedCompany(false) }))

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("CREDIT_BLOCKED")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("asks any role for an over-capacity reason and sends it as over_capacity_reason", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", OVER_CAPACITY(), booked)
    const { onBooked } = open(draftWith())

    await user.click(screen.getByRole("button", { name: "Book" }))
    await user.type(await screen.findByLabelText(/Reason for the extra guests/), "Extra bed for the child")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    const [first, retry] = calls("kamra.api.create_booking")
    expect(retry.over_capacity_reason).toBe("Extra bed for the child")
    expect(retry.idempotency_key).toBe(first.idempotency_key)
  })

  it("asks no reason when the room type can't take the party at all", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", CANT_SLEEP())
    open(draftWith())

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("can't sleep")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("keeps the first reason when Kamra then refuses for another one", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", BLACKLISTED(), CREDIT_BLOCKED(), booked)
    const { onBooked } = open(draftWith({ guest: blacklistedGuest(1), payment: blockedCompany(true) }))

    await user.click(screen.getByRole("button", { name: "Book" }))
    await user.type(await screen.findByLabelText(/blacklisted guest/), "Owner vouched")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))
    await user.type(await screen.findByLabelText(/credit limit/), "GM approved")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    const last = calls("kamra.api.create_booking")[2]
    expect(last).toMatchObject({ blacklist_override_reason: "Owner vouched", credit_override_reason: "GM approved" })
    expect(new Set(calls("kamra.api.create_booking").map((p) => p.idempotency_key)).size).toBe(1)
  })

  it("doesn't ask again for a reason Kamra already refused", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_booking", OVER_CAPACITY())
    open(draftWith())

    await user.click(screen.getByRole("button", { name: "Book" }))
    await user.type(await screen.findByLabelText(/extra guests/), "Agreed")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(calls("kamra.api.create_booking")).toHaveLength(2))
    expect(await screen.findByRole("alert")).toHaveTextContent("sleeps 2")
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})

describe("Book and check in now after Kamra refuses", () => {
  const walkIn = (p: Patch = {}) => draftWith({ ...p, stay: { check_in_date: TODAY, ...p.stay } })
  const checkInNow = () => screen.getByRole("button", { name: "Book and check in now" })
  const checkedIn = { reservation: "RES-0050", room: "R-204", checked_in: 0 }

  it("asks an admin for the blacklist reason and retries walk_in with it", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.walk_in", BLACKLISTED(), checkedIn)
    const { onBooked } = open(walkIn({ guest: blacklistedGuest(1) }))

    await user.click(checkInNow())
    await user.type(await screen.findByLabelText(/blacklisted guest/), "Owner vouched")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    const [first, retry] = calls("kamra.api.walk_in")
    expect(retry.blacklist_override_reason).toBe("Owner vouched")
    expect(retry.idempotency_key).toBe(first.idempotency_key)
  })

  it("asks Finance for the credit reason and retries walk_in with it", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.walk_in", CREDIT_BLOCKED(), checkedIn)
    const { onBooked } = open(walkIn({ payment: blockedCompany(true) }))

    await user.click(checkInNow())
    await user.type(await screen.findByLabelText(/credit limit/), "GM approved")
    await user.click(screen.getByRole("button", { name: "Book with this reason" }))

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(calls("kamra.api.walk_in")[1].credit_override_reason).toBe("GM approved")
  })

  it("asks no over-capacity reason, and suggests a bigger room type or plain Book", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.walk_in", OVER_CAPACITY())
    open(walkIn())

    await user.click(checkInNow())

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("sleeps 2")
    expect(alert).toHaveTextContent("Pick a bigger room type, or use Book to give the reason")
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})

describe("Group booking refusals", () => {
  const group = () =>
    draftWith({
      moreRooms: {
        rows: [{ id: "r1", room_type: "Suite", room_type_name: "Suite", room: "", adults: 4, children: 0, rate: { quote: null, quotedFor: "" } }],
        free: null,
        freeFor: "",
      },
      guest: blacklistedGuest(1),
    })
  const SUGGESTION = "Book a skipped room on its own to give a reason"

  it("offers no override on a skipped room, and suggests booking it on its own", async () => {
    const user = userEvent.setup()
    kamra("kamra.api.create_group_booking", {
      group_booking: "GRP-0001",
      created: ["RES-1"],
      skipped: [{ room_type: "Suite", reason: OVER_CAPACITY().message }],
    })
    open(group())

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(SUGGESTION)
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("suggests booking rooms on their own when Kamra booked none of them", async () => {
    const user = userEvent.setup()
    kamra(
      "kamra.api.create_group_booking",
      new Error(`No room could be booked, so the group was not created. ${BLACKLISTED().message}`),
    )
    open(group())

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(SUGGESTION)
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})

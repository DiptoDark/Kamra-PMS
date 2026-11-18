import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isReasonRefusal } from "./refusalReasons"
import { bookAndCheckIn, bookOneRoom, newSubmitKeys, refusalOf } from "./submit"
import type { NewBookingDraft } from "./types"

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  ...api,
}))

const draft = (payment: Partial<NewBookingDraft["payment"]> = {}): NewBookingDraft => ({
  stay: { check_in_date: "2026-11-25", check_out_date: "2026-11-27", adults: 2, children: 1 },
  room: { room_type: "Deluxe", room_type_name: "Deluxe King", room: "R-204", free: [], freeFor: "" },
  moreRooms: { rows: [], free: null, freeFor: "" },
  guest: {
    entry: "find",
    guest: "G-0007",
    guest_name: "  Rahim Uddin ",
    phone: "",
    profile: null,
    alert: null,
  },
  rate: { quote: null, quotedFor: "" },
  payment: {
    source: "Manual",
    pay: "now",
    amount: "3000",
    mode: "Card",
    payer: "guest",
    company: "",
    company_name: "",
    credit: null,
    creditFor: "",
    till: null,
    ...payment,
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

afterEach(() => vi.clearAllMocks())

describe("bookOneRoom", () => {
  it("unlocks the cashier PIN before booking when money is taken, and sends the overrides it is given", async () => {
    const order: string[] = []
    api.call.mockImplementation(async (method: string) => {
      order.push(method)
      return { reservation: "RES-9", room: "R-204" }
    })
    const ensureUnlocked = vi.fn(async () => {
      order.push("unlock")
    })
    const keys = newSubmitKeys()

    const done = await bookOneRoom.run(draft(), {
      keys,
      overrides: { blacklist_override_reason: "Owner agreed", credit_override_reason: " " },
      ensureUnlocked,
    })

    expect(order).toEqual(["unlock", "kamra.api.create_booking", "kamra.api.record_advance"])
    expect(api.call).toHaveBeenNthCalledWith(1, "kamra.api.create_booking", {
      property: "Test Hotel",
      room_type: "Deluxe",
      check_in_date: "2026-11-25",
      check_out_date: "2026-11-27",
      adults: 2,
      children: 1,
      guest_name: "Rahim Uddin",
      guest: "G-0007",
      room: "R-204",
      source: "Manual",
      blacklist_override_reason: "Owner agreed",
      idempotency_key: keys.booking,
    })
    expect(api.call).toHaveBeenNthCalledWith(2, "kamra.api.record_advance", {
      reservation: "RES-9",
      amount: 3000,
      mode: "Card",
      idempotency_key: keys.payment,
    })
    expect(done).toEqual({ reservation: "RES-9", room: "R-204", reservations: ["RES-9"], paid: 3000 })
  })

  it("doesn't ask for the PIN when nothing is collected", async () => {
    api.call.mockResolvedValue({ reservation: "RES-9", room: null })
    const ensureUnlocked = vi.fn(async () => {})

    await bookOneRoom.run(draft({ pay: "arrival" }), { keys: newSubmitKeys(), overrides: {}, ensureUnlocked })

    expect(ensureUnlocked).not.toHaveBeenCalled()
    expect(api.call).toHaveBeenCalledTimes(1)
  })
})

describe("bookAndCheckIn", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  })
  afterEach(() => vi.useRealTimers())

  /** a stay checking in today (18 Nov 2026) */
  const today = (payment: Partial<NewBookingDraft["payment"]> = {}): NewBookingDraft => {
    const d = draft({ source: null, ...payment })
    return { ...d, stay: { ...d.stay, check_in_date: "2026-11-18", check_out_date: "2026-11-20" } }
  }

  it("books through walk_in with check-in deferred, unlocking the PIN first when money is taken", async () => {
    const order: string[] = []
    api.call.mockImplementation(async (method: string) => {
      order.push(method)
      return { reservation: "RES-11", room: "R-204", room_number: "204", folio: "F-1", checked_in: 0, paid: 3000 }
    })
    const ensureUnlocked = vi.fn(async () => {
      order.push("unlock")
    })
    const keys = newSubmitKeys()

    const done = await bookAndCheckIn.run(
      today({ payer: "company", company: "ACME", company_name: "Acme Ltd", pay: "now" }),
      {
        keys,
        // walk_in takes no over-capacity reason (#15): it must not be sent
        overrides: { blacklist_override_reason: "Owner agreed", over_capacity_reason: "Extra bed" },
        ensureUnlocked,
      },
    )

    expect(order).toEqual(["unlock", "kamra.api.walk_in"])
    expect(api.call).toHaveBeenCalledWith("kamra.api.walk_in", {
      property: "Test Hotel",
      room_type: "Deluxe",
      room: "R-204",
      check_out_date: "2026-11-20",
      adults: 2,
      children: 1,
      guest_name: "Rahim Uddin",
      guest: "G-0007",
      company: "ACME",
      payment_mode: "Card",
      payment_amount: 3000,
      blacklist_override_reason: "Owner agreed",
      idempotency_key: keys.booking,
      defer_check_in: 1,
    })
    expect(done).toEqual({
      reservation: "RES-11",
      room: "R-204",
      reservations: ["RES-11"],
      paid: 3000,
      check_in: true,
    })
  })

  it("sends no payment mode and skips the PIN when paying on arrival", async () => {
    api.call.mockResolvedValue({ reservation: "RES-12", room: "R-204", checked_in: 0, paid: 0 })
    const ensureUnlocked = vi.fn(async () => {})

    await bookAndCheckIn.run(today({ pay: "arrival" }), { keys: newSubmitKeys(), overrides: {}, ensureUnlocked })

    expect(ensureUnlocked).not.toHaveBeenCalled()
    const params = api.call.mock.calls[0][1]
    expect(params).toMatchObject({ payment_amount: 0, defer_check_in: 1 })
    expect(params).not.toHaveProperty("payment_mode")
  })

  it("is offered only when check-in is today, and needs a room number", () => {
    expect(bookAndCheckIn.applies(today())).toBe(true)
    expect(bookAndCheckIn.applies(draft())).toBe(false)
    expect(bookAndCheckIn.disabledReason?.(today())).toBeNull()
    const noRoom = today()
    noRoom.room = { ...noRoom.room, room: "" }
    expect(bookAndCheckIn.disabledReason?.(noRoom)).toBe("Pick a room number to check in now.")
  })
})

describe("refusalOf", () => {
  it("sorts Kamra's refusals by what the desk can do about them", () => {
    expect(refusalOf(frappeError("Guest X is blacklisted — fraud.", "Blacklisted guest"))).toMatchObject({
      kind: "blacklist",
      message: "Guest X is blacklisted — fraud.",
      title: "Blacklisted guest",
    })
    expect(refusalOf(frappeError("CREDIT_BLOCKED: Acme: over limit.", "Company credit", "CreditBlocked")).kind).toBe(
      "credit",
    )
    expect(refusalOf(frappeError("Deluxe sleeps 2.", "Over room capacity")).kind).toBe("capacity")
    expect(refusalOf(new Error("NO_OPEN_SESSION: open your till under Finance → Cashier first.")).kind).toBe("till")
    expect(refusalOf(new Error("PIN_REQUIRED: this action needs your cashier PIN.")).kind).toBe("pin")
    expect(refusalOf(new Error("Check-in 2026-11-01 has already passed."))).toMatchObject({
      kind: "other",
      title: null,
      exc_type: null,
    })
  })

  it("reads Kamra's machine signals first, so a translated session still sorts them", () => {
    // the title and message come through _(); exc_type and the prefixes don't
    expect(refusalOf(frappeError("CREDIT_BLOCKED: Acme: เกินวงเงิน", "เครดิตบริษัท", "CreditBlocked")).kind).toBe("credit")
    // a credit block whose reasons happen to name a blacklisted guest is still a credit block
    expect(
      refusalOf(frappeError("CREDIT_BLOCKED: Acme: billed to a blacklisted guest.", "Company credit", "CreditBlocked")),
    ).toMatchObject({ kind: "credit", overridable: true })
    expect(refusalOf(frappeError("PIN_LOCKED: too many wrong attempts.", "ข้อผิดพลาด")).kind).toBe("pin")
    expect(refusalOf(frappeError("NO_OPEN_SESSION: open your till.", "ข้อผิดพลาด")).kind).toBe("till")
  })

  it("sorts a refusal the same way with or without Frappe's title (one classifier)", () => {
    // e.g. a Group booking's skipped-room reason, which comes as text only
    expect(refusalOf(new Error("Guest X is blacklisted — fraud. Remove the flag on the guest profile to book."))).toMatchObject({
      kind: "blacklist",
      overridable: true,
    })
    expect(refusalOf(new Error("Deluxe sleeps 2. Up to 1 more can be booked by arrangement."))).toMatchObject({
      kind: "capacity",
      overridable: true,
    })
    expect(refusalOf(new Error("Deluxe can't sleep 5 adults (max 3). Reduce the party."))).toMatchObject({
      kind: "capacity",
      overridable: false,
    })
  })
})

describe("isReasonRefusal", () => {
  it("agrees with refusalOf on which refusals take a reason", () => {
    expect(isReasonRefusal("CREDIT_BLOCKED: Acme: over limit.")).toBe(true)
    expect(isReasonRefusal("Guest X is blacklisted — fraud.")).toBe(true)
    expect(isReasonRefusal("Deluxe sleeps 2. Up to 1 more can be booked by arrangement.")).toBe(true)
    expect(isReasonRefusal("NO_OPEN_SESSION: open your till under Finance → Cashier first.")).toBe(false)
    expect(isReasonRefusal("No Deluxe room is free.")).toBe(false)
  })
})

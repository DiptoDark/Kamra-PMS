import { afterEach, describe, expect, it, vi } from "vitest"
import { bookOneRoom, newSubmitKeys, refusalOf } from "./submit"
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
})

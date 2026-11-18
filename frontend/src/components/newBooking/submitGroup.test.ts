import { afterEach, describe, expect, it, vi } from "vitest"
import type { Quote } from "../../lib/api"
import { bookOneRoom, newSubmitKeys, SUBMIT_PATHS } from "./submit"
import { quoteKey, rowQuoteKey } from "./steps/RateStep"
import { bookGroup } from "./submitGroup"
import type { NewBookingDraft } from "./types"

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  ...api,
}))

const q = (amount_after_tax: number) => ({ amount_after_tax, nights: 2 }) as Quote

/** A finished draft: a Deluxe (room picked) plus a Suite, unless `rows` says otherwise. */
function draft(
  payment: Partial<NewBookingDraft["payment"]> = {},
  rows: NewBookingDraft["moreRooms"]["rows"] = [
    {
      id: "a",
      room_type: "Suite",
      room_type_name: "Suite",
      room: "",
      adults: 3,
      children: 1,
      rate: { quote: q(20000), quotedFor: "" },
    },
  ],
): NewBookingDraft {
  const d: NewBookingDraft = {
    stay: { check_in_date: "2026-11-25", check_out_date: "2026-11-27", adults: 2, children: 0 },
    room: { room_type: "Deluxe", room_type_name: "Deluxe King", room: "R-204", free: [], freeFor: "" },
    moreRooms: { rows, free: {}, freeFor: "" },
    guest: {
      entry: "find",
      guest: "G-0007",
      guest_name: "  Rahim Uddin ",
      phone: "+880 1712345678",
      profile: null,
      alert: null,
    },
    rate: { quote: q(11200), quotedFor: "" },
    payment: {
      source: "Phone",
      pay: "arrival",
      amount: null,
      mode: "Cash",
      payer: "guest",
      company: "",
      company_name: "",
      credit: null,
      creditFor: "",
      till: null,
      ...payment,
    },
  }
  // the prices answer for the draft as it stands
  d.rate.quotedFor = quoteKey(d)
  d.moreRooms.rows = rows.map((r) => ({ ...r, rate: { ...r.rate, quotedFor: rowQuoteKey(d, r) } }))
  return d
}

const ctx = (ensureUnlocked = vi.fn(async () => {})) => ({ keys: newSubmitKeys(), overrides: {}, ensureUnlocked })

afterEach(() => vi.clearAllMocks())

describe("which button books", () => {
  it("books one room as a Booking, two or more as a Group booking", () => {
    const single = draft({}, [])
    expect(bookOneRoom.applies(single)).toBe(true)
    expect(bookGroup.applies(single)).toBe(false)
    expect(bookOneRoom.applies(draft())).toBe(false)
    expect(bookGroup.applies(draft())).toBe(true)
    expect(SUBMIT_PATHS).toContain(bookGroup)
  })
})

describe("bookGroup", () => {
  it("calls create_group_booking with one line per room, adults always set, and a generated group name", async () => {
    api.call.mockResolvedValue({
      group_booking: "GRP-0001",
      created: ["RES-1", "RES-2"],
      skipped: [],
      master_reservation: null,
    })

    const done = await bookGroup.run(draft({ payer: "company", company: "ACME", company_name: "Acme Ltd" }), ctx())

    expect(api.call).toHaveBeenCalledTimes(1)
    expect(api.call).toHaveBeenCalledWith("kamra.api.create_group_booking", {
      property: "Test Hotel",
      group_name: "Rahim Uddin · 2026-11-25",
      check_in_date: "2026-11-25",
      check_out_date: "2026-11-27",
      rooms: [
        { room_type: "Deluxe", count: 1, room: "R-204", adults: 2, children: 0 },
        { room_type: "Suite", count: 1, adults: 3, children: 1 },
      ],
      guest_name: "Rahim Uddin",
      phone: "+880 1712345678",
      company: "ACME",
    })
    expect(done).toEqual({
      reservation: "RES-1",
      room: null,
      reservations: ["RES-1", "RES-2"],
      group_booking: "GRP-0001",
      paid: 0,
      skipped: [],
    })
  })

  it("leaves out phone and company when there are none", async () => {
    api.call.mockResolvedValue({ group_booking: "GRP-1", created: ["RES-1", "RES-2"], skipped: [] })

    await bookGroup.run(draft(), ctx())

    const params = api.call.mock.calls[0][1] as Record<string, unknown>
    expect(params).toHaveProperty("phone")
    expect(params).not.toHaveProperty("company")

    const noPhone = draft()
    noPhone.guest.phone = ""
    await bookGroup.run(noPhone, ctx())
    expect(api.call.mock.calls[1][1]).not.toHaveProperty("phone")
  })

  it("takes the money once, on the first room, after unlocking the PIN", async () => {
    const order: string[] = []
    api.call.mockImplementation(async (method: string) => {
      order.push(method)
      return method === "kamra.api.create_group_booking"
        ? { group_booking: "GRP-1", created: ["RES-1", "RES-2"], skipped: [] }
        : { folio: "F-1" }
    })
    const c = ctx(vi.fn(async () => void order.push("unlock")))

    const done = await bookGroup.run(draft({ pay: "now" }), c)

    expect(order).toEqual(["unlock", "kamra.api.create_group_booking", "kamra.api.record_advance"])
    expect(api.call).toHaveBeenLastCalledWith("kamra.api.record_advance", {
      reservation: "RES-1",
      amount: 31200,
      mode: "Cash",
      idempotency_key: c.keys.payment,
    })
    expect(done.paid).toBe(31200)
  })

  it("reports the rooms Kamra skipped, and takes no money when not every room was booked", async () => {
    api.call.mockResolvedValue({
      group_booking: "GRP-1",
      created: ["RES-1"],
      skipped: [{ room_type: "Suite", reason: "Suite sleeps 2." }],
    })

    const done = await bookGroup.run(draft({ pay: "now" }), ctx())

    expect(api.call).toHaveBeenCalledTimes(1)
    expect(done.skipped).toEqual([{ room_type: "Suite", reason: "Suite sleeps 2." }])
    expect(done.reservations).toEqual(["RES-1"])
    expect(done.paid).toBe(0)
    expect(done.payment_error).toBe("Not every room was booked, so no payment was taken.")
  })

  it("keeps the booking when the payment fails, and says why", async () => {
    api.call.mockImplementation(async (method: string) => {
      if (method === "kamra.api.record_advance") {
        const message = "NO_OPEN_SESSION: open your till first."
        // the way lib/api throws a Frappe refusal
        throw Object.assign(new Error(message), {
          status: 417,
          body: JSON.stringify({ _server_messages: JSON.stringify([JSON.stringify({ message })]) }),
        })
      }
      return { group_booking: "GRP-1", created: ["RES-1", "RES-2"], skipped: [] }
    })

    const done = await bookGroup.run(draft({ pay: "now" }), ctx())

    expect(done.group_booking).toBe("GRP-1")
    expect(done.paid).toBe(0)
    expect(done.payment_error).toBe("NO_OPEN_SESSION: open your till first.")
  })
})

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookingInitial } from "../../../AppShell"
import type { Quote } from "../../../lib/api"
import { NewBookingDrawer } from "../NewBookingDrawer"
import type { BookingStep } from "../types"
import { datesGuestsStep } from "./DatesGuestsStep"
import { rateStep } from "./RateStep"
import { sourcePaymentStep } from "./SourcePaymentStep"

// Kamra's answers, by method. Tests override entries per case.
type Handler = (params: Record<string, unknown>) => unknown
let server: Record<string, Handler>

const api = vi.hoisted(() => ({
  getQuote: vi.fn(),
  getBookingOptions: vi.fn(),
  call: vi.fn(),
}))
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  ...api,
}))

function quote(total: number): Quote {
  return {
    nights: 2,
    nightly: [],
    room_total: total,
    meal_total: 0,
    discount: 0,
    amount_before_tax: total,
    tax_percent: 0,
    tax_amount: 0,
    amount_after_tax: total,
  }
}

// The room and guest steps are built elsewhere: stand in for them with done
// steps that seed the slices the booking reads.
const roomDone: BookingStep = {
  key: "room",
  label: "Room type & room",
  lockedHint: "",
  init: (d) => ({
    ...d,
    room: { room_type: "Deluxe", room_type_name: "Deluxe King", room: "", free: [], freeFor: "" },
  }),
  isComplete: () => true,
  Body: () => null,
}
const guestDone: BookingStep = {
  key: "guest",
  label: "Guest",
  lockedHint: "",
  init: (d) => ({
    ...d,
    guest: {
      entry: "new",
      guest: null,
      guest_name: "Rahim Uddin",
      phone: "+880 1712345678",
      profile: null,
      alert: null,
    },
  }),
  isComplete: () => true,
  Body: () => null,
}

const STEPS = [datesGuestsStep, roomDone, guestDone, rateStep, sourcePaymentStep]

function open(initial: BookingInitial = { stays: 2 }) {
  const onBooked = vi.fn()
  const onClose = vi.fn()
  render(<NewBookingDrawer initial={initial} onClose={onClose} onBooked={onBooked} steps={STEPS} />)
  return { onBooked, onClose }
}

const step = () => within(screen.getByRole("region", { name: "Source & payment" }))
const book = () => screen.getByRole("button", { name: "Book" })
const calls = (method: string) =>
  api.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  server = {
    "kamra.api.property_locale": () => ({ payment_modes: ["Cash", "Card", "bKash"] }),
    "kamra.cashier.my_till": () => ({ property: "Test Hotel", required: true, open: true }),
    "kamra.api.create_booking": () => ({
      reservation: "RES-0001",
      room: "R-101",
      amount_after_tax: 11200,
      status: "Confirmed",
    }),
    "kamra.api.record_advance": () => ({ folio: "FO-1", status: "Confirmed" }),
    "kamra.credit.company_credit_status": () => ({ applies: false, ok: true, reasons: [], policy: "warn" }),
  }
  api.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    const h = server[method]
    if (!h) throw new Error(`unexpected call ${method}`)
    return h(params)
  })
  api.getQuote.mockImplementation(async () => quote(11200))
  api.getBookingOptions.mockResolvedValue({
    room_types: [],
    companies: [
      { name: "CORP-ACME", company_name: "Acme Ltd" },
      { name: "CORP-BETA", company_name: "Beta Group" },
    ],
    property: { country: "BD" },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Source & payment step", () => {
  it("preselects Walk-in when check-in is today, and says why", async () => {
    open()

    expect(await step().findByRole("radio", { name: "Walk-in" })).toBeChecked()
    expect(step().getByRole("radio", { name: "Phone" })).not.toBeChecked()
    expect(step().getByRole("radio", { name: "Direct" })).not.toBeChecked()
    expect(step().getByText("Set to Walk-in because check-in is today. Change it if that's wrong.")).toBeInTheDocument()
  })

  it("defaults a later arrival to Phone and pay on arrival", async () => {
    open({ date: "2026-11-25", stays: 2 })

    expect(await step().findByRole("radio", { name: "Phone" })).toBeChecked()
    expect(step().getByText("Set to Phone because check-in is a later date. Change it if that's wrong.")).toBeInTheDocument()
    expect(step().getByRole("radio", { name: "On arrival" })).toBeChecked()
    expect(step().getByText("Paid when the guest arrives.")).toBeInTheDocument()
    expect(step().queryByLabelText("Amount")).not.toBeInTheDocument()
  })

  it("collects now when check-in is today: the total, in the first payment method", async () => {
    open()

    expect(await step().findByRole("radio", { name: "Collect now" })).toBeChecked()
    expect(step().getByText("Collect now because the guest is checking in today.")).toBeInTheDocument()
    expect(step().getByLabelText("Amount")).toHaveValue(11200)
    await waitFor(() => expect(step().getByLabelText("Method")).toHaveValue("Cash"))
    expect(step().getByRole("option", { name: "bKash" })).toBeInTheDocument()
  })

  it("says in the footer what is collected now", async () => {
    const user = userEvent.setup()
    open()
    const summary = () => screen.getByLabelText("Summary")

    await waitFor(() => expect(summary()).toHaveTextContent("Collect now 11,200.00"))
    await user.clear(await step().findByLabelText("Amount"))
    await user.type(step().getByLabelText("Amount"), "5000")
    expect(summary()).toHaveTextContent("Collect now 5,000.00 · 6,200.00 later")
    await user.click(step().getByRole("radio", { name: "On arrival" }))
    expect(summary()).toHaveTextContent("Pay on arrival")
  })

  it("lets the desk change the source and the payment", async () => {
    const user = userEvent.setup()
    open()

    await user.click(await step().findByRole("radio", { name: "Direct" }))
    expect(step().getByRole("radio", { name: "Direct" })).toBeChecked()
    expect(step().getByText("Required on every booking.")).toBeInTheDocument()

    await user.click(step().getByRole("radio", { name: "On arrival" }))
    expect(step().queryByLabelText("Amount")).not.toBeInTheDocument()
  })
})

describe("Company pays", () => {
  async function pickCompany(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await step().findByRole("radio", { name: "Company pays" }))
    await user.selectOptions(await step().findByLabelText("Company"), name)
  }

  it("prices on the company, checks its credit for the total, and books it as Corporate", async () => {
    const user = userEvent.setup()
    api.getQuote.mockImplementation(async (p: { company?: string }) => quote(p.company ? 9000 : 11200))
    const { onBooked } = open({ date: "2026-11-25", stays: 2 })

    await pickCompany(user, "Acme Ltd")

    await waitFor(() =>
      expect(api.getQuote).toHaveBeenLastCalledWith(expect.objectContaining({ company: "CORP-ACME" })),
    )
    await waitFor(() =>
      expect(calls("kamra.credit.company_credit_status")).toContainEqual({
        company: "CORP-ACME",
        property: "Test Hotel",
        amount: 9000,
      }),
    )
    expect(step().getByText("Acme Ltd pays the room, so nothing is collected now.")).toBeInTheDocument()

    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())
    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(calls("kamra.api.create_booking")[0]).toMatchObject({
      company: "CORP-ACME",
      market_segment: "Corporate",
    })
  })

  it("defaults to pay on arrival even when check-in is today", async () => {
    const user = userEvent.setup()
    open()

    await pickCompany(user, "Acme Ltd")
    await waitFor(() => expect(step().getByRole("radio", { name: "On arrival" })).toBeChecked())
  })

  it("can't book until a company is picked", async () => {
    const user = userEvent.setup()
    open({ date: "2026-11-25", stays: 2 })

    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(await step().findByRole("radio", { name: "Company pays" }))
    expect(book()).toBeDisabled()
  })

  it("shows a credit block with its reasons, and Book shows Kamra's refusal", async () => {
    const user = userEvent.setup()
    server["kamra.credit.company_credit_status"] = () => ({
      applies: true,
      ok: false,
      blocked: true,
      policy: "block",
      company: "Acme Ltd",
      reasons: ["Over the credit limit by 4,000.00."],
      can_override: false,
    })
    server["kamra.api.create_booking"] = () => {
      throw new Error("CREDIT_BLOCKED: Acme Ltd: Over the credit limit. Credit control blocks this booking.")
    }
    open({ date: "2026-11-25", stays: 2 })

    await pickCompany(user, "Acme Ltd")

    expect(await step().findByText("Acme Ltd: company credit is blocked")).toBeInTheDocument()
    expect(step().getByText("Over the credit limit by 4,000.00.")).toBeInTheDocument()
    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())
    expect(
      await screen.findByText("CREDIT_BLOCKED: Acme Ltd: Over the credit limit. Credit control blocks this booking."),
    ).toBeInTheDocument()
  })

  it("shows a credit warning but books", async () => {
    const user = userEvent.setup()
    server["kamra.credit.company_credit_status"] = () => ({
      applies: true,
      ok: false,
      blocked: false,
      policy: "warn",
      company: "Acme Ltd",
      reasons: ["An invoice is 40 days overdue."],
    })
    open({ date: "2026-11-25", stays: 2 })

    await pickCompany(user, "Acme Ltd")
    expect(await step().findByText("Acme Ltd: company credit warning")).toBeInTheDocument()
    await waitFor(() => expect(book()).toBeEnabled())
  })
})

describe("Book (one room)", () => {
  it("books a later arrival paid on arrival: create_booking only, then reports back and closes", async () => {
    const user = userEvent.setup()
    const { onBooked, onClose } = open({ date: "2026-11-25", stays: 2 })

    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(calls("kamra.api.create_booking")).toEqual([
      {
        property: "Test Hotel",
        room_type: "Deluxe",
        check_in_date: "2026-11-25",
        check_out_date: "2026-11-27",
        adults: 1,
        children: 0,
        guest_name: "Rahim Uddin",
        phone: "+880 1712345678",
        source: "Phone",
        idempotency_key: expect.any(String),
      },
    ])
    expect(calls("kamra.api.record_advance")).toEqual([])
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ reservation: "RES-0001", room: "R-101", paid: 0 }))
    expect(onClose).toHaveBeenCalled()
  })

  it("collects now: books, then records the money as an advance on the booking", async () => {
    const user = userEvent.setup()
    const { onBooked, onClose } = open()

    await waitFor(() => expect(step().getByLabelText("Method")).toHaveValue("Cash"))
    await user.selectOptions(step().getByLabelText("Method"), "bKash")
    await user.clear(step().getByLabelText("Amount"))
    await user.type(step().getByLabelText("Amount"), "5000")
    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())

    await waitFor(() => expect(onBooked).toHaveBeenCalled())
    expect(calls("kamra.cashier.my_till")).toContainEqual({ property: "Test Hotel" })
    expect(calls("kamra.api.create_booking")[0]).toMatchObject({ source: "Walk-in", check_in_date: "2026-11-18" })
    expect(calls("kamra.api.record_advance")).toEqual([
      { reservation: "RES-0001", amount: 5000, mode: "bKash", idempotency_key: expect.any(String) },
    ])
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ reservation: "RES-0001", paid: 5000 }))
    expect(onClose).toHaveBeenCalled()
  })

  it("can't collect with the till closed: says so and offers Pay on arrival", async () => {
    const user = userEvent.setup()
    server["kamra.cashier.my_till"] = () => ({
      property: "Test Hotel",
      required: true,
      open: false,
      session: null,
      can_open: false,
      who_can_open: ["Finance"],
    })
    open()

    expect(await step().findByText("Your till is closed, so money can't be taken now.")).toBeInTheDocument()
    expect(book()).toBeDisabled()

    await user.click(step().getByRole("button", { name: "Pay on arrival" }))
    expect(step().getByRole("radio", { name: "On arrival" })).toBeChecked()
    await waitFor(() => expect(book()).toBeEnabled())
  })

  it("needs an amount above zero to collect now", async () => {
    const user = userEvent.setup()
    open()

    await waitFor(() => expect(book()).toBeEnabled())
    await user.clear(step().getByLabelText("Amount"))
    expect(book()).toBeDisabled()
    expect(step().getByText("Enter the amount to collect.")).toBeInTheDocument()
  })

  it("shows Kamra's refusal and stays open, booking nothing", async () => {
    const user = userEvent.setup()
    server["kamra.api.create_booking"] = () => {
      throw new Error("Guest Rahim Uddin is blacklisted — unpaid bill.")
    }
    const { onBooked, onClose } = open({ date: "2026-11-25", stays: 2 })

    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())

    expect(await screen.findByText("Guest Rahim Uddin is blacklisted — unpaid bill.")).toBeInTheDocument()
    expect(onBooked).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(book()).toBeEnabled()
  })

  it("keeps the booking when the payment fails, and says to take it from the booking", async () => {
    const user = userEvent.setup()
    server["kamra.api.record_advance"] = () => {
      throw new Error("NO_OPEN_SESSION: open your till under Finance → Cashier first.")
    }
    const { onBooked, onClose } = open()

    await waitFor(() => expect(book()).toBeEnabled())
    await user.click(book())

    expect(await screen.findByText("Booked RES-0001, but the payment wasn't recorded.")).toBeInTheDocument()
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ reservation: "RES-0001", paid: 0 }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(onClose).toHaveBeenCalled()
  })
})

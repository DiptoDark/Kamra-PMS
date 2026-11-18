import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookingInitial } from "../../AppShell"
import type { Quote } from "../../lib/api"
import { NewBookingDrawer } from "./NewBookingDrawer"
import { datesGuestsStep } from "./steps/DatesGuestsStep"
import { rateStep } from "./steps/RateStep"
import { sourcePaymentStep } from "./steps/SourcePaymentStep"
import type { BookingStep } from "./types"

// Kamra's answers, by method. Tests override entries per case.
type Handler = (params: Record<string, unknown>) => unknown
let server: Record<string, Handler>

const api = vi.hoisted(() => ({
  getQuote: vi.fn(),
  getBookingOptions: vi.fn(),
  call: vi.fn(),
}))
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  ...api,
}))

const quote = (total: number): Quote => ({
  nights: 2,
  nightly: [],
  room_total: total,
  meal_total: 0,
  discount: 0,
  amount_before_tax: total,
  tax_percent: 0,
  tax_amount: 0,
  amount_after_tax: total,
})

// The room and guest steps are built elsewhere: stand in for them with done
// steps that seed the slices the booking reads (the room from `initial`).
const roomDone: BookingStep = {
  key: "room",
  label: "Room type & room",
  lockedHint: "",
  init: (d, initial) => ({
    ...d,
    room: { room_type: "Deluxe", room_type_name: "Deluxe King", room: initial.room ?? "", free: [], freeFor: "" },
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
    guest: { entry: "new", guest: null, guest_name: "Rahim Uddin", phone: "+880 1712345678", profile: null, alert: null },
  }),
  isComplete: () => true,
  Body: () => null,
}
const STEPS = [datesGuestsStep, roomDone, guestDone, rateStep, sourcePaymentStep]

function open(initial: BookingInitial = { stays: 2, room: "R-204" }) {
  const onBooked = vi.fn()
  const onClose = vi.fn()
  render(<NewBookingDrawer initial={initial} onClose={onClose} onBooked={onBooked} steps={STEPS} />)
  return { onBooked, onClose }
}

const checkInNow = () => screen.getByRole("button", { name: "Book and check in now" })
const calls = (method: string) =>
  api.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  server = {
    "kamra.api.property_locale": () => ({ payment_modes: ["Cash", "Card"] }),
    "kamra.cashier.my_till": () => ({ property: "Test Hotel", required: true, open: true }),
    "kamra.api.walk_in": () => ({
      reservation: "RES-0011",
      room: "R-204",
      room_number: "204",
      folio: "FO-11",
      checked_in: 0,
      amount_after_tax: 11200,
      paid: 11200,
    }),
    // CheckInDialog loads its own flow; an answer it can't use is enough here
    "kamra.checkin.checkin_flow": () => {
      throw new Error("flow not stubbed")
    },
  }
  api.call.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    const h = server[method]
    if (!h) throw new Error(`unexpected call ${method}`)
    return h(params)
  })
  api.getQuote.mockImplementation(async () => quote(11200))
  api.getBookingOptions.mockResolvedValue({ room_types: [], companies: [], property: { country: "BD" } })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("the hotel's today is Kamra's business date (B6)", () => {
  it("checks in on the business date when the browser's calendar is a day behind", async () => {
    // the clerk's browser says 17 Nov 23:00; the hotel is already on the 18th
    vi.setSystemTime(new Date(2026, 10, 17, 23, 0))
    server["kamra.cashier.my_till"] = () => ({
      property: "Test Hotel",
      required: true,
      open: true,
      business_date: "2026-11-18",
    })
    open()

    const checkIn = screen.getByLabelText("Check-in")
    await waitFor(() => expect(checkIn).toHaveValue("2026-11-18"))
    expect(checkIn).toHaveAttribute("min", "2026-11-18")
    expect(screen.getByLabelText("Check-out")).toHaveValue("2026-11-20")
    const step = within(screen.getByRole("region", { name: "Source & payment" }))
    expect(await step.findByRole("radio", { name: "Walk-in" })).toBeChecked()
    expect(step.getByRole("radio", { name: "Collect now" })).toBeChecked()
    expect(await screen.findByRole("button", { name: "Book and check in now" })).toBeInTheDocument()
  })

  it("keeps a check-in date the desk opened the drawer on", async () => {
    server["kamra.cashier.my_till"] = () => ({ property: "Test Hotel", required: true, open: true, business_date: "2026-11-19" })
    open({ date: "2026-11-25", stays: 2 })

    await waitFor(() => expect(screen.getByLabelText("Check-in")).toHaveAttribute("min", "2026-11-19"))
    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-11-25")
  })
})

describe("the walk-in form (AgentGuide, B9)", () => {
  it("opens on the business date with Walk-in and Collect now picked", async () => {
    server["kamra.cashier.my_till"] = () => ({ property: "Test Hotel", required: true, open: true, business_date: "2026-11-18" })
    open({ walkIn: true, date: "2026-11-25", stays: 2, room: "R-204" })

    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-11-18")
    expect(screen.getByLabelText("Check-out")).toHaveValue("2026-11-20")
    const step = within(screen.getByRole("region", { name: "Source & payment" }))
    expect(await step.findByRole("radio", { name: "Walk-in" })).toBeChecked()
    expect(step.getByRole("radio", { name: "Collect now" })).toBeChecked()
    expect(await screen.findByRole("button", { name: "Book and check in now" })).toBeInTheDocument()
  })
})

describe("Book and check in now", () => {
  it("books the walk-in with check-in deferred, then hands over to Kamra's check-in", async () => {
    const user = userEvent.setup()
    const { onBooked, onClose } = open()

    await waitFor(() => expect(checkInNow()).toBeEnabled())
    await user.click(checkInNow())

    await waitFor(() => expect(calls("kamra.api.walk_in")).toHaveLength(1))
    expect(calls("kamra.api.walk_in")[0]).toEqual({
      property: "Test Hotel",
      room_type: "Deluxe",
      room: "R-204",
      check_out_date: "2026-11-20",
      adults: 1,
      children: 0,
      guest_name: "Rahim Uddin",
      phone: "+880 1712345678",
      payment_mode: "Cash",
      payment_amount: 11200,
      idempotency_key: expect.any(String),
      defer_check_in: 1,
    })
    expect(calls("kamra.api.create_booking")).toHaveLength(0)
    expect(onBooked).toHaveBeenCalledWith(
      expect.objectContaining({ reservation: "RES-0011", room: "R-204", paid: 11200, check_in: true }),
    )

    // the booking drawer gives way to the check-in for the new booking
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument()
    expect(calls("kamra.checkin.checkin_flow")).toEqual([{ reservation: "RES-0011" }])
    expect(screen.queryByRole("heading", { name: "New booking" })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0])
    expect(onClose).toHaveBeenCalled()
  })

  it("needs a room number: the button says so until one is picked", async () => {
    open({ stays: 2 })

    await waitFor(() => expect(screen.getByRole("button", { name: "Book" })).toBeEnabled())
    expect(checkInNow()).toBeDisabled()
    expect(screen.getByText("Pick a room number to check in now.")).toBeInTheDocument()
  })

  it("isn't offered for a later arrival", async () => {
    open({ date: "2026-11-25", stays: 2, room: "R-204" })

    await waitFor(() => expect(screen.getByRole("button", { name: "Book" })).toBeEnabled())
    expect(screen.queryByRole("button", { name: "Book and check in now" })).not.toBeInTheDocument()
  })

  it("with the till closed, checks in paying on arrival: nothing collected", async () => {
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

    expect(await screen.findByText("Your till is closed, so money can't be taken now.")).toBeInTheDocument()
    expect(checkInNow()).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Pay on arrival" }))
    await waitFor(() => expect(checkInNow()).toBeEnabled())
    await user.click(checkInNow())

    await waitFor(() => expect(calls("kamra.api.walk_in")).toHaveLength(1))
    expect(calls("kamra.api.walk_in")[0]).toMatchObject({ payment_amount: 0, defer_check_in: 1 })
    expect(calls("kamra.api.walk_in")[0]).not.toHaveProperty("payment_mode")
  })

  it("shows Kamra's refusal and stays open, checking nobody in", async () => {
    const user = userEvent.setup()
    server["kamra.api.walk_in"] = () => {
      throw new Error("Deluxe King sleeps 2 adults.")
    }
    const { onBooked, onClose } = open()

    await waitFor(() => expect(checkInNow()).toBeEnabled())
    await user.click(checkInNow())

    expect(await screen.findByRole("alert")).toHaveTextContent("Deluxe King sleeps 2 adults.")
    expect(onBooked).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(calls("kamra.checkin.checkin_flow")).toHaveLength(0)
  })
})

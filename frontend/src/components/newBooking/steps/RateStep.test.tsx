import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Quote } from "../../../lib/api"
import { NewBookingDrawer } from "../NewBookingDrawer"
import type { BookingStep } from "../types"
import { datesGuestsStep } from "./DatesGuestsStep"
import { rateStep } from "./RateStep"

const api = vi.hoisted(() => ({ getQuote: vi.fn() }))
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  ...api,
}))

function quote(over: Partial<Quote> = {}): Quote {
  return {
    nights: 2,
    nightly: [
      { date: "2026-11-18", rate: 5000 },
      { date: "2026-11-19", rate: 5000 },
    ],
    room_total: 10000,
    meal_total: 0,
    discount: 0,
    amount_before_tax: 10000,
    tax_percent: 12,
    tax_amount: 1200,
    amount_after_tax: 11200,
    ...over,
  }
}

// The room and guest steps are built elsewhere: stand in for them with
// steps that are done (the room one seeds the room slice the rate reads).
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
let guestIsDone = true
const guestDone: BookingStep = {
  key: "guest",
  label: "Guest",
  lockedHint: "",
  isComplete: () => guestIsDone,
  Body: () => null,
}
// The step after the rate: unlocks only once the rate step is complete.
const next: BookingStep = {
  key: "next",
  label: "Next",
  lockedHint: "next is locked",
  isComplete: () => true,
  Body: () => <p>next body</p>,
}

function open() {
  return render(
    <NewBookingDrawer
      initial={{ stays: 2 }}
      onClose={() => {}}
      steps={[datesGuestsStep, roomDone, guestDone, rateStep, next]}
    />,
  )
}

const rate = () => within(screen.getByRole("region", { name: "Rate" }))
const summary = () => screen.getByLabelText("Summary")

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  guestIsDone = true
  api.getQuote.mockResolvedValue(quote())
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Rate step", () => {
  it("prices the stay with Kamra's quote and shows the total read-only", async () => {
    open()

    expect(await rate().findByText("11,200.00")).toBeInTheDocument()
    expect(api.getQuote).toHaveBeenCalledWith({
      room_type: "Deluxe",
      check_in_date: "2026-11-18",
      check_out_date: "2026-11-20",
      adults: 1,
      children: 0,
    })
    // D1: no typed rate
    expect(rate().queryByRole("spinbutton")).not.toBeInTheDocument()
    expect(rate().queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.getByText("next body")).toBeInTheDocument()
  })

  it("shows the nightly rate, tax and discount behind the total", async () => {
    api.getQuote.mockResolvedValue(quote({ discount: 500, amount_before_tax: 9500, tax_amount: 1140, amount_after_tax: 10640 }))
    open()

    const body = await rate().findByLabelText("Price")
    expect(body).toHaveTextContent("5,000.00 × 2 nights")
    expect(body).toHaveTextContent("Room10,000.00")
    expect(body).toHaveTextContent("Discount−500.00")
    expect(body).toHaveTextContent("Tax (12%)1,140.00")
    expect(body).toHaveTextContent("Total10,640.00")
  })

  it("lists each night when the nightly rate varies", async () => {
    api.getQuote.mockResolvedValue(
      quote({
        nightly: [
          { date: "2026-11-18", rate: 4000 },
          { date: "2026-11-19", rate: 6000 },
        ],
      }),
    )
    open()

    const body = await rate().findByLabelText("Price")
    expect(body).toHaveTextContent("2026-11-184,000.00")
    expect(body).toHaveTextContent("2026-11-196,000.00")
  })

  it("puts the nights and total in the footer summary", async () => {
    open()

    await waitFor(() => expect(summary()).toHaveTextContent("2 nights · Total 11,200.00"))
  })

  it("says it is pricing while the quote loads, and the next step stays locked", async () => {
    let answer!: (q: Quote) => void
    api.getQuote.mockReturnValue(new Promise<Quote>((r) => (answer = r)))
    open()

    expect(await rate().findByText("Getting the price…")).toBeInTheDocument()
    expect(screen.getByText("next is locked")).toBeInTheDocument()

    answer(quote())
    expect(await screen.findByText("next body")).toBeInTheDocument()
  })

  it("shows Kamra's refusal, keeps the next step locked, and tries again on Retry", async () => {
    const user = userEvent.setup()
    api.getQuote.mockRejectedValueOnce(new Error("Check-in 2026-11-18 is closed to arrival."))
    open()

    expect(await rate().findByText("Check-in 2026-11-18 is closed to arrival.")).toBeInTheDocument()
    expect(screen.getByText("next is locked")).toBeInTheDocument()
    expect(summary()).not.toHaveTextContent("Total")

    await user.click(rate().getByRole("button", { name: "Try again" }))
    expect(await rate().findByText("11,200.00")).toBeInTheDocument()
    expect(screen.getByText("next body")).toBeInTheDocument()
  })

  it("re-prices when the stay changes, and drops the old price meanwhile", async () => {
    const user = userEvent.setup()
    open()
    expect(await rate().findByText("11,200.00")).toBeInTheDocument()

    let answer!: (q: Quote) => void
    api.getQuote.mockReturnValue(new Promise<Quote>((r) => (answer = r)))
    await user.clear(screen.getByLabelText("Adults"))
    await user.type(screen.getByLabelText("Adults"), "2")

    await waitFor(() =>
      expect(api.getQuote).toHaveBeenLastCalledWith(expect.objectContaining({ adults: 2 })),
    )
    expect(rate().queryByText("11,200.00")).not.toBeInTheDocument()
    expect(summary()).not.toHaveTextContent("Total")
    expect(screen.getByText("next is locked")).toBeInTheDocument()

    answer(quote({ amount_after_tax: 13440 }))
    expect(await rate().findByText("13,440.00")).toBeInTheDocument()
    expect(summary()).toHaveTextContent("Total 13,440.00")
  })

  it("ignores a quote that answers for inputs already changed", async () => {
    const user = userEvent.setup()
    const answers: ((q: Quote) => void)[] = []
    api.getQuote.mockImplementation(() => new Promise<Quote>((r) => answers.push(r)))
    open()
    await waitFor(() => expect(answers).toHaveLength(1))

    await user.clear(screen.getByLabelText("Adults"))
    await user.type(screen.getByLabelText("Adults"), "2")
    await waitFor(() => expect(answers).toHaveLength(2))

    answers[1](quote({ amount_after_tax: 13440 }))
    expect(await rate().findByText("13,440.00")).toBeInTheDocument()
    answers[0](quote({ amount_after_tax: 11200 }))
    await new Promise((r) => setTimeout(r, 20))
    expect(rate().queryByText("11,200.00")).not.toBeInTheDocument()
    expect(summary()).toHaveTextContent("Total 13,440.00")
  })
})

describe("Rate step with more rooms (Group booking)", () => {
  // the room step stand-in, now with a second and third room
  const roomsDone: BookingStep = {
    ...roomDone,
    init: (d) => ({
      ...roomDone.init!(d, {}),
      moreRooms: {
        free: {},
        freeFor: "",
        rows: [
          {
            id: "a", room_type: "Suite", room_type_name: "Suite", room: "", adults: 3, children: 1,
            rate: { quote: null, quotedFor: "" },
          },
          {
            id: "b", room_type: "Deluxe", room_type_name: "Deluxe King", room: "", adults: 1, children: 0,
            rate: { quote: null, quotedFor: "" },
          },
        ],
      },
    }),
  }
  const openGroup = () =>
    render(
      <NewBookingDrawer
        initial={{ stays: 2 }}
        onClose={() => {}}
        steps={[datesGuestsStep, roomsDone, guestDone, rateStep, next]}
      />,
    )

  beforeEach(() => {
    api.getQuote.mockImplementation(async (p: { room_type: string; adults: number }) =>
      p.room_type === "Suite"
        ? quote({ amount_after_tax: 20000 })
        : quote({ amount_after_tax: p.adults === 1 ? 11200 : 12000 }),
    )
  })

  it("prices each room on its own guests and shows each room's price and the total", async () => {
    openGroup()

    const body = await rate().findByLabelText("Price")
    await waitFor(() => expect(body).toHaveTextContent("Total42,400.00"))
    expect(body).toHaveTextContent("Room 1 · Deluxe King11,200.00")
    expect(body).toHaveTextContent("Room 2 · Suite20,000.00")
    expect(body).toHaveTextContent("Room 3 · Deluxe King11,200.00")
    expect(api.getQuote).toHaveBeenCalledWith({
      room_type: "Suite",
      check_in_date: "2026-11-18",
      check_out_date: "2026-11-20",
      adults: 3,
      children: 1,
    })
    expect(screen.getByText("next body")).toBeInTheDocument()
  })

  it("puts each room's price and the total in the footer summary", async () => {
    openGroup()

    await waitFor(() => expect(summary()).toHaveTextContent("2 nights · Total 42,400.00"))
    expect(summary()).toHaveTextContent("Room 2 · Suite20,000.00")
  })

  it("keeps the next step locked until every room is priced", async () => {
    let answer!: (q: Quote) => void
    api.getQuote.mockImplementation((p: { room_type: string }) =>
      p.room_type === "Suite" ? new Promise<Quote>((r) => (answer = r)) : Promise.resolve(quote()),
    )
    openGroup()

    await waitFor(() => expect(answer).toBeTypeOf("function"))
    expect(screen.getByText("next is locked")).toBeInTheDocument()
    expect(summary()).not.toHaveTextContent("Total")

    answer(quote({ amount_after_tax: 20000 }))
    expect(await screen.findByText("next body")).toBeInTheDocument()
  })

  it("shows a room's refusal on that room and tries it again", async () => {
    const user = userEvent.setup()
    api.getQuote.mockImplementation(async (p: { room_type: string }) => {
      if (p.room_type === "Suite") throw new Error("Suite is closed to arrival.")
      return quote()
    })
    openGroup()

    expect(await rate().findByText("Suite is closed to arrival.")).toBeInTheDocument()
    expect(screen.getByText("next is locked")).toBeInTheDocument()

    api.getQuote.mockImplementation(async () => quote({ amount_after_tax: 20000 }))
    await user.click(rate().getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("next body")).toBeInTheDocument()
  })
})

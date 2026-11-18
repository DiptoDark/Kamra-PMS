import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewBookingDrawer } from "./NewBookingDrawer"
import { datesGuestsStep } from "./steps/DatesGuestsStep"
import type { BookingStep } from "./types"

// The full flow's steps load options, free rooms, guests and the price:
// answer them all here so this file never reaches the network.
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  getBookingOptions: vi.fn(async () => ({ room_types: [], property: { country: null } })),
  call: vi.fn(async () => []),
  guestSearch: vi.fn(async () => []),
  guestAlert: vi.fn(async () => ({ guest: null, blacklisted: 0, blacklist_reason: null })),
  getQuote: vi.fn(async () => {
    throw new Error("no quote in these tests")
  }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
})
afterEach(() => vi.useRealTimers())

describe("NewBookingDrawer", () => {
  it("opens on the dates & guests step with today, one night, 1 adult and no children", () => {
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "New booking" })).toBeInTheDocument()
    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-11-18")
    expect(screen.getByLabelText("Check-out")).toHaveValue("2026-11-19")
    expect(screen.getByLabelText("Adults")).toHaveValue(1)
    expect(screen.getByLabelText("Children")).toHaveValue(0)
  })

  it("prefills the stay from how it was opened", () => {
    render(
      <NewBookingDrawer
        initial={{ date: "2026-12-01", stays: 3, adults: 2, children: 1 }}
        onClose={() => {}}
      />,
    )

    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-12-01")
    expect(screen.getByLabelText("Check-out")).toHaveValue("2026-12-04")
    expect(screen.getByLabelText("Adults")).toHaveValue(2)
    expect(screen.getByLabelText("Children")).toHaveValue(1)
  })

  it("unlocks the room step once the dates are valid, and locks it again when they aren't", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    const roomStep = screen.getByRole("region", { name: "Room type & room" })
    expect(roomStep).not.toHaveAttribute("aria-disabled")

    const checkOut = screen.getByLabelText("Check-out")
    await user.clear(checkOut)
    await user.type(checkOut, "2026-11-17")

    expect(roomStep).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText("Check-out must be after check-in.")).toBeInTheDocument()
  })

  it("keeps every step after dates & guests locked while the stay is invalid", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{ date: "2026-11-10" }} onClose={() => {}} />)

    expect(screen.getByText("Check-in can't be in the past.")).toBeInTheDocument()
    for (const name of ["Room type & room", "Guest", "Rate", "Source & payment"])
      expect(screen.getByRole("region", { name })).toHaveAttribute("aria-disabled", "true")

    await user.clear(screen.getByLabelText("Check-in"))
    await user.type(screen.getByLabelText("Check-in"), "2026-11-20")
    await user.clear(screen.getByLabelText("Adults"))
    expect(screen.getByRole("region", { name: "Room type & room" })).toHaveAttribute("aria-disabled", "true")

    await user.type(screen.getByLabelText("Adults"), "1")
    expect(screen.getByRole("region", { name: "Room type & room" })).not.toHaveAttribute("aria-disabled")
  })

  it("can't book until every step is complete, and Cancel closes the drawer", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<NewBookingDrawer initial={{}} onClose={onClose} />)

    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("runs steps from their own files: each unlocks when the ones before it are complete", () => {
    const step = (key: string, done: boolean): BookingStep => ({
      key,
      label: key,
      lockedHint: `${key} is locked`,
      isComplete: () => done,
      Body: () => <p>{key} body</p>,
      Summary: () => <span>{key} summary</span>,
    })
    const { rerender } = render(
      <NewBookingDrawer
        initial={{}}
        onClose={() => {}}
        steps={[datesGuestsStep, step("first", false), step("second", true)]}
      />,
    )
    expect(screen.getByText("first body")).toBeInTheDocument()
    expect(screen.getByText("second is locked")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled()

    rerender(
      <NewBookingDrawer
        initial={{}}
        onClose={() => {}}
        steps={[datesGuestsStep, step("first", true), step("second", true)]}
      />,
    )
    expect(screen.getByText("second body")).toBeInTheDocument()
    expect(screen.getByText("second summary")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Book" })).toBeEnabled()
  })
})

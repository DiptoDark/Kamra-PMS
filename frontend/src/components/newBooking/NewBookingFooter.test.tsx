import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { NewBookingFooter } from "./NewBookingFooter"
import type { BookingDone, SubmitPath } from "./submit"
import type { NewBookingDraft } from "./types"

function open(done: BookingDone) {
  const path: SubmitPath = { key: "group", label: "Book", applies: () => true, run: async () => done }
  const onClose = vi.fn()
  const onBooked = vi.fn()
  render(
    <NewBookingFooter
      draft={{} as NewBookingDraft}
      update={() => {}}
      steps={[]}
      ready
      onClose={onClose}
      onBooked={onBooked}
      paths={[path]}
    />,
  )
  return { onClose, onBooked }
}

const group: BookingDone = {
  reservation: "RES-1",
  room: null,
  reservations: ["RES-1", "RES-2"],
  group_booking: "GRP-0001",
  paid: 0,
  skipped: [],
}

describe("NewBookingFooter after a Group booking", () => {
  it("closes when every room was booked", async () => {
    const user = userEvent.setup()
    const { onClose, onBooked } = open(group)

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(onBooked).toHaveBeenCalledWith(group)
    expect(onClose).toHaveBeenCalled()
  })

  it("stays open to show each room Kamra skipped and why", async () => {
    const user = userEvent.setup()
    const partial: BookingDone = {
      ...group,
      reservations: ["RES-1"],
      skipped: [
        { room_type: "Suite", reason: "Suite sleeps 2." },
        { room_type: "Deluxe", reason: "No Deluxe room is free." },
      ],
    }
    const { onClose, onBooked } = open(partial)

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(onBooked).toHaveBeenCalledWith(partial)
    expect(onClose).not.toHaveBeenCalled()
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Booked 1 of 3 rooms in GRP-0001.")
    expect(alert).toHaveTextContent("Suite: Suite sleeps 2.")
    expect(alert).toHaveTextContent("Deluxe: No Deluxe room is free.")

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("says no payment was taken when Kamra skipped a room", async () => {
    const user = userEvent.setup()
    const { onClose } = open({
      ...group,
      reservations: ["RES-1"],
      skipped: [{ room_type: "Suite", reason: "Suite sleeps 2." }],
      payment_withheld: "rooms_skipped",
    })

    await user.click(screen.getByRole("button", { name: "Book" }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Not every room was booked, so no payment was taken.")
  })
})

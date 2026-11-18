import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { call, getBookingOptions } from "../../../lib/api"
import { NewBookingDrawer } from "../NewBookingDrawer"

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  getCurrentProperty: () => "Test Hotel",
  getBookingOptions: vi.fn(),
  call: vi.fn(),
}))

const ROOM_TYPES = [
  { name: "Standard", room_type_name: "Standard", base_price: 3000, adults_capacity: 2, children_capacity: 1 },
  { name: "Deluxe", room_type_name: "Deluxe King", base_price: 5000, adults_capacity: 2, children_capacity: 2 },
  { name: "Suite", room_type_name: "Suite", base_price: 9000, adults_capacity: 4, children_capacity: 2 },
]

/** Free rooms per room type, keyed by check-in date; default is the 18th. */
let free: Record<string, Record<string, { name: string; room_number: string; housekeeping_status?: string }[]>>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  free = {
    "2026-11-18": {
      Standard: [],
      Deluxe: [
        { name: "R-102", room_number: "102", housekeeping_status: "Dirty" },
        { name: "R-101", room_number: "101", housekeeping_status: "Clean" },
      ],
      Suite: [{ name: "R-301", room_number: "301", housekeeping_status: "Clean" }],
    },
    "2026-11-20": {
      Standard: [{ name: "R-001", room_number: "1", housekeeping_status: "Clean" }],
      Deluxe: [],
      Suite: [{ name: "R-301", room_number: "301", housekeeping_status: "Clean" }],
    },
  }
  vi.mocked(getBookingOptions).mockResolvedValue({ room_types: ROOM_TYPES } as never)
  vi.mocked(call).mockImplementation(async (method: string, args?: Record<string, unknown>) => {
    if (method !== "kamra.api.available_rooms") throw new Error(`unexpected ${method}`)
    return (free[args!.check_in_date as string]?.[args!.room_type as string] ?? []) as never
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const roomStep = () => screen.getByRole("region", { name: "Room type & room" })
const guestStep = () => screen.getByRole("region", { name: "Guest" })

describe("Room type & room step", () => {
  it("lists each room type with how many rooms are free for the stay", async () => {
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)

    const step = within(roomStep())
    expect(await step.findByRole("button", { name: /Deluxe King/ })).toHaveTextContent("2 free")
    expect(step.getByRole("button", { name: /Suite/ })).toHaveTextContent("1 free")
    expect(step.getByRole("button", { name: /Standard/ })).toHaveTextContent("Sold out")
    expect(step.getByRole("button", { name: /Standard/ })).toBeDisabled()
    expect(call).toHaveBeenCalledWith("kamra.api.available_rooms", {
      property: "Test Hotel",
      room_type: "Deluxe",
      check_in_date: "2026-11-18",
      check_out_date: "2026-11-19",
    })
  })

  it("is complete once a room type is chosen; the room is optional and assigned automatically", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    expect(guestStep()).toHaveAttribute("aria-disabled", "true")

    await user.click(await within(roomStep()).findByRole("button", { name: /Deluxe King/ }))

    expect(within(roomStep()).getByRole("button", { name: /Deluxe King/ })).toHaveAttribute("aria-pressed", "true")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
    expect(within(roomStep()).getByLabelText(/Room number/)).toHaveDisplayValue("Assign automatically")
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Deluxe King · room assigned on booking")
  })

  it("offers the free rooms of the chosen type, clean ones first", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    await user.click(await within(roomStep()).findByRole("button", { name: /Deluxe King/ }))

    const select = within(roomStep()).getByLabelText(/Room number/)
    const options = within(select).getAllByRole("option").map((o) => o.textContent)
    expect(options).toEqual(["Assign automatically", "Room 101", "Room 102"])

    await user.selectOptions(select, "R-102")
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Deluxe King · Room 102")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
  })

  it("reloads when the dates change and re-locks if the chosen type is no longer free", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    await user.click(await within(roomStep()).findByRole("button", { name: /Deluxe King/ }))
    expect(guestStep()).not.toHaveAttribute("aria-disabled")

    await user.clear(screen.getByLabelText("Check-in"))
    await user.type(screen.getByLabelText("Check-in"), "2026-11-20")

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("kamra.api.available_rooms", expect.objectContaining({
        room_type: "Deluxe",
        check_in_date: "2026-11-20",
        check_out_date: "2026-11-21",
      })),
    )
    await waitFor(() =>
      expect(within(roomStep()).getByRole("button", { name: /Deluxe King/ })).toHaveTextContent("Sold out"),
    )
    expect(guestStep()).toHaveAttribute("aria-disabled", "true")
    expect(within(roomStep()).getByText(/No Deluxe King room is free for these dates/)).toBeInTheDocument()

    await user.click(within(roomStep()).getByRole("button", { name: /Standard/ }))
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
  })

  it("prefills the room type, and the room, from how the drawer was opened", async () => {
    render(<NewBookingDrawer initial={{ room_type: "Deluxe", room: "R-102" }} onClose={() => {}} />)

    expect(await within(roomStep()).findByRole("button", { name: /Deluxe King/ })).toHaveAttribute("aria-pressed", "true")
    expect(within(roomStep()).getByLabelText(/Room number/)).toHaveValue("R-102")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Deluxe King · Room 102")
  })

  it("keeps the chosen room when it is still free for the new dates, and drops it when it isn't", async () => {
    free["2026-11-20"].Deluxe = [{ name: "R-101", room_number: "101", housekeeping_status: "Clean" }]
    free["2026-11-21"] = { ...free["2026-11-18"], Deluxe: [{ name: "R-102", room_number: "102" }] }
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    await user.click(await within(roomStep()).findByRole("button", { name: /Deluxe King/ }))
    await user.selectOptions(within(roomStep()).getByLabelText(/Room number/), "R-101")

    await user.clear(screen.getByLabelText("Check-in"))
    await user.type(screen.getByLabelText("Check-in"), "2026-11-20")
    await waitFor(() => expect(within(roomStep()).getByRole("button", { name: /Deluxe King/ })).toHaveTextContent("1 free"))
    expect(within(roomStep()).getByLabelText(/Room number/)).toHaveValue("R-101")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")

    await user.clear(screen.getByLabelText("Check-in"))
    await user.type(screen.getByLabelText("Check-in"), "2026-11-21")
    await waitFor(() => expect(within(roomStep()).getByLabelText(/Room number/)).toHaveValue(""))
    expect(within(roomStep()).getByLabelText(/Room number/)).toHaveDisplayValue("Assign automatically")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
  })
})

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

const FREE: Record<string, { name: string; room_number: string; housekeeping_status?: string }[]> = {
  Standard: [],
  Deluxe: [
    { name: "R-101", room_number: "101", housekeeping_status: "Clean" },
    { name: "R-102", room_number: "102", housekeeping_status: "Clean" },
  ],
  Suite: [{ name: "R-301", room_number: "301", housekeeping_status: "Clean" }],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  vi.mocked(getBookingOptions).mockResolvedValue({ room_types: ROOM_TYPES } as never)
  vi.mocked(call).mockImplementation(async (method: string, args?: Record<string, unknown>) => {
    if (method !== "kamra.api.available_rooms") throw new Error(`unexpected ${method}`)
    return (FREE[args!.room_type as string] ?? []) as never
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const roomStep = () => within(screen.getByRole("region", { name: "Room type & room" }))
const guestStep = () => screen.getByRole("region", { name: "Guest" })
const row = (n: number) => within(screen.getByRole("group", { name: `Room ${n}` }))

async function pickFirstRoom(user: ReturnType<typeof userEvent.setup>, type = /Deluxe King/) {
  render(<NewBookingDrawer initial={{ adults: 2 }} onClose={() => {}} />)
  await user.click(await roomStep().findByRole("button", { name: type }))
}

describe("More rooms (Group booking)", () => {
  it("offers to add another room once the first room type is chosen", async () => {
    const user = userEvent.setup()
    render(<NewBookingDrawer initial={{}} onClose={() => {}} />)
    await roomStep().findByRole("button", { name: /Deluxe King/ })
    expect(roomStep().queryByRole("button", { name: "+ Add another room" })).not.toBeInTheDocument()

    await user.click(roomStep().getByRole("button", { name: /Deluxe King/ }))
    expect(roomStep().getByRole("button", { name: "+ Add another room" })).toBeInTheDocument()
  })

  it("adds a room row with its own type, room and guests, and the guest step waits for it", async () => {
    const user = userEvent.setup()
    await pickFirstRoom(user)
    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))

    expect(row(2).getByLabelText("Room type")).toHaveValue("")
    // a new room starts with the first room's adults
    expect(row(2).getByLabelText("Adults")).toHaveValue(2)
    expect(row(2).getByLabelText("Children")).toHaveValue(0)
    expect(guestStep()).toHaveAttribute("aria-disabled", "true")

    await user.selectOptions(row(2).getByLabelText("Room type"), "Suite")
    expect(guestStep()).not.toHaveAttribute("aria-disabled")
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Group booking · 2 rooms")
  })

  it("lists sold-out room types as unavailable in a row", async () => {
    const user = userEvent.setup()
    await pickFirstRoom(user)
    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))

    const standard = within(row(2).getByLabelText("Room type")).getByRole("option", { name: /Standard/ })
    expect(standard).toBeDisabled()
  })

  it("won't take more rooms of a type than are free, and never the same room twice", async () => {
    const user = userEvent.setup()
    await pickFirstRoom(user)
    await user.selectOptions(roomStep().getByLabelText(/Room number/), "R-101")

    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))
    await user.selectOptions(row(2).getByLabelText("Room type"), "Deluxe")
    // R-101 is the first room's: the second Deluxe can only be 102
    const options = within(row(2).getByLabelText(/Room number/)).getAllByRole("option").map((o) => o.textContent)
    expect(options).toEqual(["Assign automatically", "Room 102"])
    expect(guestStep()).not.toHaveAttribute("aria-disabled")

    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))
    await user.selectOptions(row(3).getByLabelText("Room type"), "Deluxe")
    expect(row(3).getByText("Only 2 Deluxe King rooms are free for these dates.")).toBeInTheDocument()
    expect(guestStep()).toHaveAttribute("aria-disabled", "true")
  })

  it("turns back into a plain booking when the extra rooms are removed", async () => {
    const user = userEvent.setup()
    await pickFirstRoom(user)
    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))
    await user.selectOptions(row(2).getByLabelText("Room type"), "Suite")
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Group booking · 2 rooms")

    await user.click(row(2).getByRole("button", { name: "Remove room" }))

    expect(screen.queryByRole("group", { name: "Room 2" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Summary")).toHaveTextContent("Deluxe King · room assigned on booking")
    expect(screen.getByLabelText("Summary")).not.toHaveTextContent("Group booking")
  })

  it("needs at least one adult in each room", async () => {
    const user = userEvent.setup()
    await pickFirstRoom(user)
    await user.click(roomStep().getByRole("button", { name: "+ Add another room" }))
    await user.selectOptions(row(2).getByLabelText("Room type"), "Suite")
    await user.clear(row(2).getByLabelText("Adults"))
    await user.type(row(2).getByLabelText("Adults"), "0")

    expect(row(2).getByText("At least one adult.")).toBeInTheDocument()
    await waitFor(() => expect(guestStep()).toHaveAttribute("aria-disabled", "true"))
  })
})

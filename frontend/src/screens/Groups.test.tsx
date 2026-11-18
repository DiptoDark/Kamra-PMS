import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { BookingDone } from "../components/newBooking/submit"
import Groups from "./Groups"

// The list itself loads from Kamra; only its header button matters here.
vi.mock("../components/ResourceScreen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/ResourceScreen")>()),
  ResourceScreen: (props: { headerAction?: ReactNode }) => <div>{props.headerAction}</div>,
}))

// The drawer is exercised in its own tests: stand it in with buttons that
// report a booking and then close, the way it does.
const groupDone: BookingDone = {
  reservation: "RES-1",
  room: null,
  reservations: ["RES-1", "RES-2"],
  group_booking: "GRP-0007",
  paid: 0,
}
const oneRoomDone: BookingDone = { reservation: "RES-3", room: null, reservations: ["RES-3"], paid: 0 }
vi.mock("../components/newBooking/NewBookingDrawer", () => ({
  NewBookingDrawer: (props: { onClose: () => void; onBooked?: (d: BookingDone) => void }) => (
    <div role="dialog" aria-label="New booking">
      <button onClick={() => (props.onBooked?.(groupDone), props.onClose())}>book group</button>
      <button onClick={() => (props.onBooked?.(oneRoomDone), props.onClose())}>book one room</button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}))
vi.mock("../components/GroupBookingDialog", () => ({
  default: () => <div role="dialog" aria-label="Old group booking" />,
}))

function Where() {
  const loc = useLocation()
  return <output aria-label="search">{loc.search}</output>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Groups />
      <Where />
    </MemoryRouter>,
  )
}

describe("Groups", () => {
  it("opens the new booking drawer from New group booking", async () => {
    const user = userEvent.setup()
    renderAt("/groups")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "New group booking" }))

    expect(screen.getByRole("dialog", { name: "New booking" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Old group booking" })).not.toBeInTheDocument()
  })

  it("opens the drawer when linked with ?new=1, and drops the flag on close", async () => {
    const user = userEvent.setup()
    renderAt("/groups?new=1")
    expect(screen.getByRole("dialog", { name: "New booking" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "close" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByLabelText("search")).toHaveTextContent(/^$/)
  })

  it("opens the new Group booking once it is made", async () => {
    const user = userEvent.setup()
    renderAt("/groups?new=1")

    await user.click(screen.getByRole("button", { name: "book group" }))

    expect(screen.getByLabelText("search")).toHaveTextContent("?open=GRP-0007")
  })

  it("leaves the list as it is when only one room was booked", async () => {
    const user = userEvent.setup()
    renderAt("/groups?new=1")

    await user.click(screen.getByRole("button", { name: "book one room" }))

    expect(screen.getByLabelText("search")).toHaveTextContent(/^$/)
  })
})

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookingInitial } from "../../../AppShell"
import type { GuestAlert, GuestHit } from "../../../lib/api"
import { NewBookingDrawer } from "../NewBookingDrawer"
import type { BookingStep } from "../types"
import { datesGuestsStep } from "./DatesGuestsStep"
import { guestStep, resetGuestStepCache } from "./GuestStep"

const api = vi.hoisted(() => ({
  guestSearch: vi.fn(),
  guestAlert: vi.fn(),
  getBookingOptions: vi.fn(),
}))
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  ...api,
}))

const asha: GuestHit = {
  name: "GUEST-0001",
  full_name: "Asha Rahman",
  phone: "+8801712345678",
  email: null,
  vip: 1,
  blacklisted: 0,
  blacklist_reason: null,
  stays: 3,
  last_stay: "2026-09-02",
}
const clear: GuestAlert = { guest: null, blacklisted: 0, blacklist_reason: null }

// The room step is built elsewhere: stand in for it with one that is done.
const roomDone: BookingStep = {
  key: "room",
  label: "Room type & room",
  lockedHint: "",
  isComplete: () => true,
  Body: () => null,
}
// The step after the guest: unlocks only once the guest step is complete,
// and shows what the guest step handed on.
const next: BookingStep = {
  key: "next",
  label: "Next",
  lockedHint: "next is locked",
  isComplete: () => true,
  Body: ({ draft }) => <output aria-label="guest out">{JSON.stringify(draft.guest)}</output>,
}

function open(initial: BookingInitial = {}) {
  return render(
    <NewBookingDrawer
      initial={initial}
      onClose={() => {}}
      steps={[datesGuestsStep, roomDone, guestStep, next]}
    />,
  )
}
const guestRegion = () => screen.getByRole("region", { name: "Guest" })
const handedOn = () => JSON.parse(screen.getByLabelText("guest out").textContent ?? "null")

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0))
  resetGuestStepCache()
  api.guestSearch.mockResolvedValue([])
  api.guestAlert.mockResolvedValue(clear)
  api.getBookingOptions.mockResolvedValue({ property: { country: "Bangladesh" } })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Guest step", () => {
  it("is locked until a guest is chosen or named", () => {
    open()
    expect(screen.getByText("next is locked")).toBeInTheDocument()
  })

  it("finds an existing guest and hands on the guest profile with their name and phone", async () => {
    const user = userEvent.setup()
    api.guestSearch.mockResolvedValue([asha])
    open()

    await user.type(within(guestRegion()).getByLabelText("Find a guest"), "Asha")
    await user.click(await screen.findByRole("option", { name: /Asha Rahman/ }))

    expect(api.guestSearch).toHaveBeenLastCalledWith("Asha")
    expect(within(guestRegion()).getByText("Asha Rahman")).toBeInTheDocument()
    expect(handedOn()).toMatchObject({
      guest: "GUEST-0001",
      guest_name: "Asha Rahman",
      phone: "+8801712345678",
    })
  })

  it("enters a new guest: the name and a complete phone are both required", async () => {
    const user = userEvent.setup()
    open()

    await user.type(within(guestRegion()).getByLabelText("Find a guest"), "Karim Uddin")
    await user.click(within(guestRegion()).getByRole("button", { name: "+ New guest “Karim Uddin”" }))

    const name = within(guestRegion()).getByLabelText("Full name")
    expect(name).toHaveValue("Karim Uddin")
    // Bedlu books a new guest on name + phone: no phone, no booking
    expect(screen.getByText("next is locked")).toBeInTheDocument()
    expect(screen.getByText("Enter the guest's phone number.")).toBeInTheDocument()

    await user.clear(name)
    expect(screen.getByText("next is locked")).toBeInTheDocument()
    expect(screen.getByText("Enter the guest's name.")).toBeInTheDocument()

    await user.type(name, "Karim")
    await waitFor(() =>
      expect(within(guestRegion()).getByLabelText("Country calling code")).toHaveValue("880"),
    )
    const phone = within(guestRegion()).getByRole("textbox", { name: /phone/i })
    await user.type(phone, "1712")
    expect(screen.getByText("next is locked")).toBeInTheDocument()

    await user.type(phone, "345678")
    expect(handedOn()).toMatchObject({ guest: null, guest_name: "Karim", phone: "+8801712345678" })
  })

  it("takes a prefilled local phone that the property's country completes", async () => {
    open({ guest_name: "Karim", phone: "01712345678" })

    // the form shows no phone problem, so the step must not stay locked
    await waitFor(() => expect(handedOn()).toMatchObject({ guest_name: "Karim", phone: "01712345678" }))
    expect(screen.queryByText("Finish the phone number.")).not.toBeInTheDocument()
  })

  it("warns when the chosen guest is blacklisted, and says who may still book them", async () => {
    const user = userEvent.setup()
    api.guestSearch.mockResolvedValue([{ ...asha, blacklisted: 1 }])
    api.guestAlert.mockResolvedValue({
      guest: "GUEST-0001",
      full_name: "Asha Rahman",
      blacklisted: 1,
      blacklist_reason: "Damaged the room",
      can_override: 0,
    })
    open()

    await user.type(within(guestRegion()).getByLabelText("Find a guest"), "Asha")
    await user.click(await screen.findByRole("option", { name: /Asha Rahman/ }))

    const alert = await within(guestRegion()).findByRole("alert")
    expect(api.guestAlert).toHaveBeenCalledWith({ guest: "GUEST-0001" })
    expect(alert).toHaveTextContent("Asha Rahman is blacklisted")
    expect(alert).toHaveTextContent("Damaged the room")
    expect(alert).toHaveTextContent("Only a Hotel Admin can book a blacklisted guest.")
    expect(handedOn()).toMatchObject({ alert: { blacklisted: 1, can_override: 0 } })
  })

  it("checks a new guest's phone against blacklisted profiles", async () => {
    const user = userEvent.setup()
    api.guestAlert.mockResolvedValue({
      guest: null,
      full_name: null,
      blacklisted: 1,
      blacklist_reason: null,
      can_override: 1,
    })
    open()

    await user.click(within(guestRegion()).getByRole("button", { name: "+ New guest" }))
    await user.type(within(guestRegion()).getByLabelText("Full name"), "Karim")
    await waitFor(() =>
      expect(within(guestRegion()).getByLabelText("Country calling code")).toHaveValue("880"),
    )
    await user.type(within(guestRegion()).getByRole("textbox", { name: /phone/i }), "1712345678")

    const alert = await within(guestRegion()).findByRole("alert")
    expect(api.guestAlert).toHaveBeenCalledWith({ phone: "+8801712345678" })
    expect(alert).toHaveTextContent("This guest is blacklisted")
    expect(alert).toHaveTextContent("you'll be asked for a reason")
  })

  it("Change guest goes back to the search and locks the steps after it", async () => {
    const user = userEvent.setup()
    open({ guest: "GUEST-0001", guest_name: "Asha Rahman", phone: "+8801712345678" })

    expect(within(guestRegion()).getByText("Asha Rahman")).toBeInTheDocument()
    expect(handedOn()).toMatchObject({ guest: "GUEST-0001", guest_name: "Asha Rahman" })

    await user.click(within(guestRegion()).getByRole("button", { name: "Change guest" }))
    expect(within(guestRegion()).getByLabelText("Find a guest")).toBeInTheDocument()
    expect(screen.getByText("next is locked")).toBeInTheDocument()
  })
})

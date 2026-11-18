import { describe, expect, it } from "vitest"

// Spec #2: every entry point opens the New booking drawer, and Kamra's old
// booking dialogs stay in the repo unused (ADR 0001).
const sources = import.meta.glob<string>(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
})

const OLD = ["components/BookingDialog", "components/GroupBookingDialog"]

function importersOf(target: string) {
  const name = target.split("/").pop()!
  const ref = new RegExp(`(from\\s*|import\\(\\s*)["'][^"']*/${name}["']`)
  return Object.entries(sources)
    .filter(([path]) => !OLD.some((old) => path === `./${old}.tsx`))
    .filter(([, code]) => ref.test(code))
    .map(([path]) => path)
}

describe("booking entry points", () => {
  it.each(OLD)("nothing imports %s any more", (old) => {
    expect(importersOf(old)).toEqual([])
  })

  it("the app shell opens the New booking drawer", () => {
    expect(importersOf("components/newBooking/NewBookingDrawer")).toEqual(
      expect.arrayContaining(["./AppShell.tsx", "./screens/Groups.tsx"]),
    )
  })
})

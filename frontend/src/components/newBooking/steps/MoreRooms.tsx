/*  More rooms: "+ Add another room" under the room type & room step
    (decision D4). The step's own picker is the first room; each room added
    here is a row with its own room type, room and adults / children. Two
    or more rooms make a Group booking (submitGroup.ts); removing the rows
    turns it back into a plain Booking. Guest, source and payment are
    entered once for all of them. */

import { Trash2 } from "lucide-react"
import type { BookingOptions } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { Field, inputCls } from "../fields"
import type { NewBookingDraft, StayDraft, StepProps } from "../types"
import type { RateDraft } from "./RateStep"
import type { FreeRoom } from "./RoomStep"

/** One room after the first. */
export interface RoomRow {
  /** stable id, so a late answer finds its row after others are removed */
  id: string
  /** Room Type name, "" until one is chosen */
  room_type: string
  room_type_name: string
  /** a specific Room name; "" = Kamra assigns one */
  room: string
  adults: number
  children: number
  /** this room's price (the rate step fills it) */
  rate: RateDraft
}

/** The extra rooms slice. `free` lists every room type's free rooms for
 *  the stay in `freeFor`; the room step refreshes it with its own. */
export interface MoreRoomsDraft {
  rows: RoomRow[]
  free: Record<string, FreeRoom[]> | null
  freeFor: string
}

declare module "../types" {
  interface NewBookingDraft {
    moreRooms: MoreRoomsDraft
  }
}

export const emptyMoreRooms = (): MoreRoomsDraft => ({ rows: [], free: null, freeFor: "" })

/** The rooms after the first; none for a plain Booking. */
export const extraRows = (draft: NewBookingDraft): RoomRow[] => draft.moreRooms?.rows ?? []

/** Two or more rooms: this is a Group booking. */
export const isGroup = (draft: NewBookingDraft) => extraRows(draft).length > 0

const stayKey = (stay: StayDraft) => `${stay.check_in_date}|${stay.check_out_date}`

/** The room step learnt what's free for the stay `key`: keep it, and let a
 *  picked room that's no longer free go back to "assign automatically". */
export function refreshMoreRooms(
  draft: NewBookingDraft,
  free: Record<string, FreeRoom[]>,
  key: string,
): NewBookingDraft {
  const more = draft.moreRooms ?? emptyMoreRooms()
  const rows = more.rows.map((r) =>
    r.room && !(free[r.room_type] ?? []).some((f) => f.name === r.room) ? { ...r, room: "" } : r,
  )
  return { ...draft, moreRooms: { rows, free, freeFor: key } }
}

/** Why a row can't be booked yet: an English message (for t()) and its
 *  placeholders, or null. A row without a room type yet has no message
 *  but isn't complete either (see moreRoomsComplete). */
export function rowProblem(
  draft: NewBookingDraft,
  index: number,
): { message: string; vars?: Record<string, string | number> } | null {
  const rows = extraRows(draft)
  const row = rows[index]
  if (!Number.isInteger(row.adults) || row.adults < 1) return { message: "At least one adult." }
  if (!Number.isInteger(row.children) || row.children < 0) return { message: "Children can't be negative." }
  if (!row.room_type) return null
  const free = draft.moreRooms.free?.[row.room_type] ?? []
  const type = row.room_type_name
  if (free.length === 0)
    return { message: "No {type} room is free for these dates. Pick another room type.", vars: { type } }
  // the first room and every earlier row of this type come first
  const before = [draft.room, ...rows.slice(0, index)].filter((r) => r.room_type === row.room_type)
  if (before.length + 1 > free.length)
    return { message: "Only {n} {type} rooms are free for these dates.", vars: { n: free.length, type } }
  if (row.room) {
    const picked = free.find((f) => f.name === row.room)
    if (!picked) return { message: "Pick another room." }
    if (before.some((r) => r.room === row.room))
      return { message: "Room {number} is already in this booking.", vars: { number: picked.room_number } }
  }
  return null
}

/** Every extra room has a type, guests and a free room for this stay. */
export function moreRoomsComplete(draft: NewBookingDraft): boolean {
  const rows = extraRows(draft)
  if (rows.length === 0) return true
  if (draft.moreRooms.freeFor !== stayKey(draft.stay)) return false
  return rows.every((r, i) => !!r.room_type && rowProblem(draft, i) === null)
}

let nextId = 0

type RoomType = BookingOptions["room_types"][number]

/** The rows and the "+ Add another room" link, under the first room. */
export function MoreRooms({
  draft,
  update,
  types,
}: StepProps & { types: RoomType[] }) {
  const { t, tn } = useT()
  const rows = extraRows(draft)
  const free = draft.moreRooms?.free ?? {}
  const setRows = (change: (rows: RoomRow[]) => RoomRow[]) =>
    update((d) => {
      const more = d.moreRooms ?? emptyMoreRooms()
      return { ...d, moreRooms: { ...more, rows: change(more.rows) } }
    })
  const patch = (id: string, p: Partial<RoomRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const count = (value: string) => (value === "" ? NaN : Number(value))

  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        id: `row-${++nextId}`,
        room_type: "",
        room_type_name: "",
        room: "",
        adults: Number.isInteger(draft.stay.adults) && draft.stay.adults > 0 ? draft.stay.adults : 1,
        children: 0,
        rate: { quote: null, quotedFor: "" },
      },
    ])

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => {
        const problem = rowProblem(draft, i)
        // rooms the first room or another row already holds
        const taken = new Set([draft.room.room, ...rows.filter((r) => r.id !== row.id).map((r) => r.room)])
        const rooms = (free[row.room_type] ?? []).filter((f) => f.name === row.room || !taken.has(f.name))
        const label = t("Room {n}", { n: i + 2 })
        return (
          <fieldset key={row.id} className="rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-sm font-semibold">{label}</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label={t("Room type")}>
                  <select
                    className={inputCls}
                    value={row.room_type}
                    onChange={(e) => {
                      const type = types.find((rt) => rt.name === e.target.value)
                      patch(row.id, {
                        room_type: type?.name ?? "",
                        room_type_name: type?.room_type_name ?? "",
                        room: "",
                      })
                    }}
                  >
                    <option value="">{t("Choose a room type")}</option>
                    {types.map((rt) => {
                      const n = free[rt.name]?.length ?? 0
                      return (
                        <option key={rt.name} value={rt.name} disabled={n === 0}>
                          {n === 0
                            ? t("{type} · Sold out", { type: rt.room_type_name })
                            : tn(n, "{type} · {n} free", "{type} · {n} free", { type: rt.room_type_name })}
                        </option>
                      )
                    })}
                  </select>
                </Field>
              </div>
              {row.room_type && rooms.length > 0 && (
                <div className="col-span-2">
                  <Field label={t("Room number (optional)")}>
                    <select
                      className={inputCls}
                      value={row.room}
                      onChange={(e) => patch(row.id, { room: e.target.value })}
                    >
                      <option value="">{t("Assign automatically")}</option>
                      {rooms.map((r) => (
                        <option key={r.name} value={r.name}>
                          {t("Room {number}", { number: r.room_number })}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Field label={t("Adults")}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className={inputCls}
                  value={Number.isNaN(row.adults) ? "" : row.adults}
                  onChange={(e) => patch(row.id, { adults: count(e.target.value) })}
                />
              </Field>
              <Field label={t("Children")}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className={inputCls}
                  value={Number.isNaN(row.children) ? "" : row.children}
                  onChange={(e) => patch(row.id, { children: count(e.target.value) })}
                />
              </Field>
            </div>
            {problem && (
              <p aria-live="polite" className="mt-2 text-sm text-rose-600">
                {t(problem.message, problem.vars)}
              </p>
            )}
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-rose-600"
              onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
            >
              <Trash2 aria-hidden className="size-3.5" />
              {t("Remove room")}
            </button>
          </fieldset>
        )
      })}
      <button
        type="button"
        className="self-start text-sm font-medium text-brand-600 underline"
        onClick={add}
      >
        {t("+ Add another room")}
      </button>
    </div>
  )
}

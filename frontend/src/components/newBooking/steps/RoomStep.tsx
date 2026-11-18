/*  Step 2 · Room type & room. Lists what's free for the stay
    (kamra.api.available_rooms, one call per room type) and asks for a
    room type; a specific room is optional here and auto-assigned on Book. */

import { useEffect, useState } from "react"
import { call, getBookingOptions, getCurrentProperty, type BookingOptions } from "../../../lib/api"
import { useT } from "../../../lib/i18n"
import { todayPlus } from "../../../lib/stay"
import { cn } from "../../../lib/utils"
import { Field, inputCls } from "../fields"
import type { BookingStep, StayDraft, StepProps } from "../types"

/** The room type & room slice of the draft. */
export interface RoomDraft {
  /** Room Type name, "" until one is chosen */
  room_type: string
  /** its display name, for the summary */
  room_type_name: string
  /** a specific Room name; "" = Kamra assigns one on Book */
  room: string
  /** the free rooms of room_type for the stay in `freeFor`, null while loading */
  free: FreeRoom[] | null
  /** the stay (check-in|check-out) `free` was checked for */
  freeFor: string
}

declare module "../types" {
  interface NewBookingDraft {
    room: RoomDraft
  }
}

const emptyRoom = (): RoomDraft => ({
  room_type: "",
  room_type_name: "",
  room: "",
  free: null,
  freeFor: "",
})

export const stayKey = (stay: StayDraft) => `${stay.check_in_date}|${stay.check_out_date}`

type RoomType = BookingOptions["room_types"][number]

export interface FreeRoom {
  name: string
  room_number: string
  housekeeping_status?: string
}

/** Clean or inspected rooms first, then by room number. */
function cleanFirst(rooms: FreeRoom[]) {
  const rank = (r: FreeRoom) =>
    r.housekeeping_status === "Clean" || r.housekeeping_status === "Inspected" ? 0 : 1
  return [...rooms].sort(
    (a, b) =>
      rank(a) - rank(b) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
  )
}

function RoomBody({ draft, update }: StepProps) {
  const { t, tn } = useT()
  const { check_in_date, check_out_date } = draft.stay
  const [types, setTypes] = useState<RoomType[] | null>(null)
  const [free, setFree] = useState<Record<string, FreeRoom[]> | null>(null)

  useEffect(() => {
    let live = true
    getBookingOptions()
      .then((o) => live && setTypes(o.room_types))
      .catch(() => live && setTypes([]))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!types) return
    let live = true
    const key = `${check_in_date}|${check_out_date}`
    setFree(null)
    Promise.all(
      types.map((rt) =>
        call<FreeRoom[]>("kamra.api.available_rooms", {
          property: getCurrentProperty(),
          room_type: rt.name,
          check_in_date,
          check_out_date,
          // checking in today: leave out rooms whose guest is still in them
          ...(check_in_date === todayPlus(0) ? { ready_now: 1 } : {}),
        })
          .catch(() => [] as FreeRoom[])
          .then((rooms) => [rt.name, cleanFirst(rooms)] as const),
      ),
    ).then((pairs) => {
      if (!live) return
      const map: Record<string, FreeRoom[]> = Object.fromEntries(pairs)
      setFree(map)
      // the chosen type's rooms now answer for this stay; a picked room
      // that was taken in the meantime goes back to "assign automatically"
      update((d) => {
        // a prefilled type this property doesn't have is dropped, not kept
        const type = types.find((rt) => rt.name === d.room.room_type)
        if (!type) return d.room.room_type ? { ...d, room: emptyRoom() } : d
        const rooms = map[type.name] ?? []
        const room = rooms.some((r) => r.name === d.room.room) ? d.room.room : ""
        return {
          ...d,
          room: { ...d.room, room_type_name: type.room_type_name, room, free: rooms, freeFor: key },
        }
      })
    })
    return () => {
      live = false
    }
    // `update` is a fresh closure each render; the stay is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, check_in_date, check_out_date])

  if (!types || !free) return <p className="text-sm text-zinc-500">{t("Checking what's free…")}</p>

  const key = stayKey(draft.stay)
  const chosen = draft.room
  const setRoom = (patch: Partial<RoomDraft>) =>
    update((d) => ({ ...d, room: { ...d.room, ...patch } }))

  const chosenFree = chosen.room_type ? (free[chosen.room_type] ?? []) : []

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {types.map((rt) => {
          const n = free[rt.name]?.length ?? 0
          const on = chosen.room_type === rt.name
          return (
            <button
              key={rt.name}
              type="button"
              disabled={n === 0}
              aria-pressed={on}
              onClick={() =>
                setRoom({
                  room_type: rt.name,
                  room_type_name: rt.room_type_name,
                  room: "",
                  free: free[rt.name] ?? [],
                  freeFor: key,
                })
              }
              className={cn(
                "flex flex-col items-start rounded-lg border border-zinc-300 px-3.5 py-2.5 text-start",
                on && "border-brand-600 bg-brand-50 ring-1 ring-brand-600",
                n === 0 && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="font-medium">{rt.room_type_name}</span>
              <span className="text-sm text-zinc-500">
                {n === 0 ? t("Sold out") : tn(n, "{n} free", "{n} free")}
              </span>
            </button>
          )
        })}
      </div>
      {chosen.room_type && chosenFree.length === 0 && (
        <p className="text-sm text-rose-600">
          {t("No {type} room is free for these dates. Pick another room type.", {
            type: chosen.room_type_name,
          })}
        </p>
      )}
      {chosenFree.length > 0 && (
        <Field label={t("Room number (optional)")}>
          <select
            className={inputCls}
            value={chosen.room}
            onChange={(e) => setRoom({ room: e.target.value })}
          >
            <option value="">{t("Assign automatically")}</option>
            {chosenFree.map((r) => (
              <option key={r.name} value={r.name}>
                {t("Room {number}", { number: r.room_number })}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}

/** The step is done: a room type with a free room for this very stay, and
 *  the chosen room (if any) still among them. */
export function roomChosen(draft: { stay: StayDraft; room: RoomDraft }) {
  const { room } = draft
  return (
    !!room.room_type &&
    room.freeFor === stayKey(draft.stay) &&
    !!room.free?.length &&
    (!room.room || room.free.some((r) => r.name === room.room))
  )
}

function RoomSummary({ draft }: StepProps) {
  const { t } = useT()
  const room = draft.room
  if (!roomChosen(draft)) return null
  const picked = room.free!.find((r) => r.name === room.room)
  return (
    <span>
      {picked
        ? t("{type} · Room {number}", { type: room.room_type_name, number: picked.room_number })
        : t("{type} · room assigned on booking", { type: room.room_type_name })}
    </span>
  )
}

export const roomStep: BookingStep = {
  key: "room",
  label: "Room type & room",
  lockedHint: "Pick valid dates and guests to see what's free.",
  // a room from the tape chart counts only while its room type came with it
  init: (draft, initial) => ({
    ...draft,
    room: {
      ...emptyRoom(),
      room_type: initial.room_type ?? "",
      room: initial.room_type ? (initial.room ?? "") : "",
    },
  }),
  isComplete: roomChosen,
  Body: RoomBody,
  Summary: RoomSummary,
}

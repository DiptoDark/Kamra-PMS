/*  Form bits shared by the New booking steps, styled like Kamra's
    BookingDialog. Labels arrive already translated. */

import type { ReactNode } from "react"

export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-base " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-600">{props.label}</span>
      {props.children}
      {props.hint}
    </label>
  )
}

/*  The drawer's pinned footer: each step's summary line above the buttons.
    Book stays disabled until every step is complete; the booking call
    itself (create_booking / create_group_booking / walk_in) lands with the
    source & payment ticket, here. */

import { useT } from "../../lib/i18n"
import { Button } from "../ui/button"
import type { BookingStep, StepProps } from "./types"

const BIG = "h-11 min-w-24 px-5 text-base"

export function NewBookingFooter(
  props: StepProps & {
    steps: BookingStep[]
    ready: boolean
    onClose: () => void
  },
) {
  const { t } = useT()
  const { draft, update } = props
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm text-zinc-700" aria-label={t("Summary")}>
        {props.steps.map((s) => (s.Summary ? <s.Summary key={s.key} draft={draft} update={update} /> : null))}
      </div>
      {!props.ready && (
        <p className="text-end text-xs text-zinc-500">{t("Finish every step to book.")}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" className={BIG} onClick={props.onClose}>
          {t("Cancel")}
        </Button>
        <Button className={BIG} disabled={!props.ready}>
          {t("Book")}
        </Button>
      </div>
    </div>
  )
}

/*  New booking drawer (Bedlu's "Book a room", ported per ADR 0001).

    A side Sheet whose steps sit one under another and unlock in order:
    a step's body shows only once every step before it is complete. The
    steps come from steps/index.ts, one file each; this file only runs them.
    The footer (NewBookingFooter) shows the summary above the buttons. */

import { useMemo, useState } from "react"
import { Check, Lock } from "lucide-react"
import type { BookingInitial } from "../../AppShell"
import { useT } from "../../lib/i18n"
import { cn } from "../../lib/utils"
import { Sheet } from "../ui/sheet"
import { NewBookingFooter } from "./NewBookingFooter"
import { BOOKING_STEPS } from "./steps"
import type { BookingDone } from "./submit"
import type { BookingStep, DraftUpdate, NewBookingDraft } from "./types"

export function initialDraft(steps: BookingStep[], initial: BookingInitial): NewBookingDraft {
  return steps.reduce<NewBookingDraft>(
    (draft, step) => (step.init ? step.init(draft, initial) : draft),
    {} as NewBookingDraft,
  )
}

/** How far the booking has got: which steps are open and which are done. */
export function stepStates(steps: BookingStep[], draft: NewBookingDraft) {
  let open = true
  return steps.map((step) => {
    const unlocked = open
    const complete = unlocked && step.isComplete(draft)
    open = complete
    return { step, unlocked, complete }
  })
}

export function NewBookingDrawer(props: {
  initial: BookingInitial
  onClose: () => void
  /** A booking was made: refresh whatever the caller shows. */
  onBooked?: (done: BookingDone) => void
  /** Defaults to the full flow; tests and later variants may pass their own. */
  steps?: BookingStep[]
}) {
  const { t } = useT()
  const steps = props.steps ?? BOOKING_STEPS
  const [draft, setDraft] = useState(() => initialDraft(steps, props.initial))
  const update: DraftUpdate = (change) => setDraft((d) => change(d))
  const states = useMemo(() => stepStates(steps, draft), [steps, draft])

  return (
    <Sheet
      title={t("New booking")}
      description={t("Availability first, then the guest. Steps unlock in order.")}
      onClose={props.onClose}
      footer={
        <NewBookingFooter
          draft={draft}
          update={update}
          steps={steps}
          ready={states.every((s) => s.complete)}
          onClose={props.onClose}
          onBooked={props.onBooked}
        />
      }
    >
      <div className="flex flex-col gap-6">
        {states.map(({ step, unlocked, complete }, i) => {
          const headingId = `nb-step-${step.key}`
          return (
            <section
              key={step.key}
              aria-labelledby={headingId}
              aria-disabled={!unlocked || undefined}
              data-step={step.key}
              className={cn(!unlocked && "opacity-60")}
            >
              <h3 id={headingId} className="mb-3 flex items-center gap-2 text-base font-semibold">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                    complete
                      ? "bg-emerald-500 text-white"
                      : unlocked
                        ? "bg-brand-600 text-white"
                        : "bg-zinc-100 text-zinc-500",
                  )}
                >
                  {complete ? <Check className="size-3.5" /> : unlocked ? i + 1 : <Lock className="size-3" />}
                </span>
                {t(step.label)}
              </h3>
              {unlocked ? (
                <step.Body draft={draft} update={update} />
              ) : (
                <p className="text-sm text-zinc-500">{t(step.lockedHint)}</p>
              )}
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}

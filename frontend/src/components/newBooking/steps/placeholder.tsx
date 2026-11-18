/*  Stand-in for a step whose ticket hasn't landed yet: it shows when
    unlocked but never completes, so the steps after it stay locked.
    A step's own ticket replaces its file (RoomStep.tsx, ...) wholesale. */

import { useT } from "../../../lib/i18n"
import type { BookingStep } from "../types"

function NotYet() {
  const { t } = useT()
  return <p className="text-sm text-zinc-500">{t("This step isn't available yet.")}</p>
}

export function placeholderStep(key: string, label: string, lockedHint: string): BookingStep {
  return { key, label, lockedHint, isComplete: () => false, Body: NotYet }
}

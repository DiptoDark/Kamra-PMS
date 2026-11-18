import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"

import { ResourceScreen } from "../components/ResourceScreen"
import { NewBookingDrawer } from "../components/newBooking/NewBookingDrawer"
import { Button } from "../components/ui/button"
import { useT } from "../lib/i18n"
import { groupsConfig } from "./configs"

/** Groups & Blocks with a "New group booking" button (?new=1 opens it).
 *  It opens the New booking drawer: adding a second room there makes the
 *  booking a Group booking, which this screen then opens. */
export default function Groups() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true)
  }, [params])
  // bumping the key remounts the list so the new group shows up
  const [reloadKey, setReloadKey] = useState(0)
  // the Group booking the drawer made, opened once the drawer closes (the
  // drawer can stay open after booking to list rooms Kamra skipped)
  const bookedGroup = useRef<string | null>(null)
  const close = () => {
    setCreating(false)
    const group = bookedGroup.current
    bookedGroup.current = null
    // ?open= opens the new group's dashboard (ResourceScreen)
    if (group) setParams({ open: group }, { replace: true })
    else if (params.has("new")) setParams({}, { replace: true })
  }

  return (
    <>
      <ResourceScreen
        key={reloadKey}
        config={groupsConfig}
        headerAction={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t("New group booking")}
          </Button>
        }
      />
      {creating && (
        <NewBookingDrawer
          initial={{}}
          onClose={close}
          onBooked={(done) => {
            setReloadKey((k) => k + 1)
            bookedGroup.current = done.group_booking ?? null
          }}
        />
      )}
    </>
  )
}

"use client"

import { useEffect } from "react"
import { toast } from "sonner"

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    let reloading = false
    const onControllerChange = () => {
      // A new SW just took control — refresh once so the new bundle wins.
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    )

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Already-waiting worker (e.g. user navigated to a page that
        // re-registers after install finished).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptForUpdate(registration.waiting)
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A new SW has installed and an old one still controls the
              // page — prompt the user to apply the update.
              promptForUpdate(installing)
            }
          })
        })
      })
      .catch(() => {})

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      )
    }
  }, [])
  return null
}

function promptForUpdate(worker: ServiceWorker) {
  toast("A new version is available", {
    description: "Reload to apply the update. Unsynced reports are kept.",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
    },
  })
}

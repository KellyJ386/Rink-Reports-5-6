"use client"

// =============================================================================
// PwaInstallPrompt — contextual "install to home screen" banner.
//
// Two platforms, two flows:
//  - Android / Chromium: the browser fires `beforeinstallprompt`. We capture
//    it, suppress the default mini-infobar, and drive the *native* install
//    dialog from our own button via `prompt()`.
//  - iOS Safari: there is no `beforeinstallprompt`. Installing is a manual
//    "Share → Add to Home Screen" gesture, so we show instructions instead.
//
// The banner is:
//  - hidden when the app is already running standalone (installed),
//  - dismissible, with the dismissal persisted in localStorage so we don't
//    nag on every visit,
//  - styled with the RinkReports brand tokens (Navy #001A3A surface, brand
//    `rr-green` #4DFF00 accent). The navy surface is a fixed brand color for an
//    intentionally branded banner, so it reads the same in light and dark mode;
//    the green uses the `rr-green` token so it tracks the brand primary.
//
// Implementation note: install-ability is browser/OS state that only exists on
// the client and changes via window events, so we read it through
// `useSyncExternalStore` (a tiny module-scoped store) rather than setState in
// an effect — the same SSR-safe pattern theme-toggle.tsx uses. This component
// does NOT register the service worker (that's SwRegister) and never touches
// Supabase or the offline IndexedDB queue.
// =============================================================================

import { useSyncExternalStore } from "react"
import { Share, SquarePlus, X } from "lucide-react"

// localStorage flag so a dismissal sticks across visits. Bump the suffix if we
// ever want to re-surface the prompt to everyone (e.g. after a big update).
const DISMISS_KEY = "rr-pwa-install-dismissed"

// The `beforeinstallprompt` event isn't in the standard DOM lib types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type Platform = "android" | "ios" | "other"

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other"
  const ua = navigator.userAgent
  // iPadOS 13+ reports as "Macintosh" but exposes touch — treat touch Macs as iOS.
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  if (isIOS) return "ios"
  if (/android/i.test(ua)) return "android"
  return "other"
}

// True when the app is already installed / launched from the home screen.
function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag instead of display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// ---------------------------------------------------------------------------
// Module-scoped install store. State lives outside React so multiple subtrees
// share one source of truth and we never call setState inside an effect.
// ---------------------------------------------------------------------------
type Mode = "ios" | "android"
interface Snapshot {
  show: boolean
  mode: Mode | null
}

// The captured Android event, replayed when the user taps "Install".
let deferredPrompt: BeforeInstallPromptEvent | null = null
let dismissed = false
let installed = false
let platform: Platform = "other"
let initialized = false

// Cached so getSnapshot returns a stable reference until something changes
// (a fresh object every call would loop useSyncExternalStore forever).
let snapshot: Snapshot = { show: false, mode: null }
const listeners = new Set<() => void>()

function recompute() {
  let show = false
  let mode: Mode | null = null
  if (!dismissed && !installed) {
    if (platform === "ios") {
      // iOS has no install event — surface the manual instructions.
      show = true
      mode = "ios"
    } else if (deferredPrompt) {
      // Android/Chromium told us the app is installable.
      show = true
      mode = "android"
    }
  }
  if (show !== snapshot.show || mode !== snapshot.mode) {
    snapshot = { show, mode }
    listeners.forEach((l) => l())
  }
}

function persistDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1")
  } catch {
    // ignore quota / disabled storage
  }
}

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault() // suppress the default mini-infobar; we drive it ourselves
  deferredPrompt = e as BeforeInstallPromptEvent
  recompute()
}

function onAppInstalled() {
  installed = true
  deferredPrompt = null
  persistDismissed() // never nag again once installed
  recompute()
}

// useSyncExternalStore subscribe — runs client-side only (in an effect), so
// it's the right place to read browser state and attach window listeners.
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!initialized) {
    initialized = true
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1"
    } catch {
      dismissed = false
    }
    installed = isStandalone()
    platform = detectPlatform()
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onAppInstalled)
    recompute()
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onAppInstalled)
      initialized = false
    }
  }
}

function getSnapshot(): Snapshot {
  return snapshot
}

// SSR (and the first client render before subscribe runs) both see the hidden
// default, so hydration matches and the banner only appears post-mount.
function getServerSnapshot(): Snapshot {
  return { show: false, mode: null }
}

function dismiss() {
  dismissed = true
  persistDismissed()
  recompute()
}

async function runInstall() {
  if (!deferredPrompt) return
  const evt = deferredPrompt
  await evt.prompt()
  const { outcome } = await evt.userChoice
  // A used prompt can't be replayed; drop it and close the banner either way.
  deferredPrompt = null
  if (outcome === "accepted") {
    dismissed = true
    persistDismissed()
  } else {
    // Treat a declined prompt as a dismissal for this session too.
    dismissed = true
  }
  recompute()
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export function PwaInstallPrompt() {
  const { show, mode } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label="Install Rink Reports"
      // Fixed bottom banner that clears the iOS home-bar via safe-area inset.
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mx-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border border-rr-green/40 bg-[#001A3A] p-4 text-white shadow-lg">
        {/* Brand-green app glyph */}
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rr-green text-[#001A3A]">
          <SquarePlus className="h-5 w-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="text-base font-semibold"
            style={{ fontFamily: "var(--font-anton), sans-serif" }}
          >
            Install Rink Reports
          </p>

          {mode === "ios" ? (
            <p className="mt-1 text-sm leading-snug text-white/80">
              Tap the{" "}
              <Share
                className="inline h-4 w-4 -translate-y-0.5 text-rr-green"
                aria-label="Share"
              />{" "}
              Share button below, then choose{" "}
              <span className="font-semibold text-white">
                &ldquo;Add to Home Screen&rdquo;
              </span>
              .
            </p>
          ) : (
            <p className="mt-1 text-sm leading-snug text-white/80">
              Add it to your home screen for one-tap, full-screen access — works
              offline too.
            </p>
          )}

          {/* Android gets a real install button; iOS is instructions-only. */}
          {mode === "android" && (
            <button
              type="button"
              onClick={runInstall}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-lg bg-rr-green px-4 text-sm font-semibold text-[#001A3A] transition-colors hover:bg-[var(--rr-green-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rr-green focus-visible:ring-offset-2 focus-visible:ring-offset-[#001A3A]"
            >
              Install app
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rr-green"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

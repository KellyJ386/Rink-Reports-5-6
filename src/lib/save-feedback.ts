"use client"

// Confirmation feedback (beep + vibration) for reading saves.
// - Beep: Web Audio oscillator — no audio file, works fully offline.
// - Buzz: navigator.vibrate — Android/Chrome only; iOS Safari silently no-ops.
//
// Must be called from within a user gesture (tap/keypress handler) so the
// browser autoplay policy allows audio. Purely cosmetic: every path is
// try/catch'd and a feedback failure must never interrupt a save.

let audioCtx: AudioContext | null = null

export function playSaveFeedback(): void {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === "suspended") void audioCtx.resume()

    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()

    osc.type = "sine"
    osc.frequency.value = 880 // A5 — short, clean confirmation tone
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15)

    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.15)
  } catch {
    // Audio unavailable — never block the save over feedback
  }

  try {
    navigator.vibrate?.(100)
  } catch {
    // Vibration unsupported — expected on iOS
  }
}

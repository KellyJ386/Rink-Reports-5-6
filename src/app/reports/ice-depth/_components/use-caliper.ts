"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

import { parseCaliperReading } from "../_lib/caliper"

// Web Bluetooth isn't in the TS DOM lib and we intentionally don't pull in
// @types/web-bluetooth (no new dependency), so declare the minimal slice we
// actually touch. Kept local rather than ambient-global to avoid leaking these
// onto `navigator` everywhere.
type GattCharacteristic = {
  properties: { notify: boolean; indicate: boolean }
  startNotifications(): Promise<GattCharacteristic>
  stopNotifications(): Promise<GattCharacteristic>
  addEventListener(type: "characteristicvaluechanged", cb: (e: Event) => void): void
  removeEventListener(type: "characteristicvaluechanged", cb: (e: Event) => void): void
  value?: DataView
}
type GattService = {
  getCharacteristics(): Promise<GattCharacteristic[]>
}
type GattServer = {
  connected: boolean
  connect(): Promise<GattServer>
  disconnect(): void
  getPrimaryServices(): Promise<GattService[]>
}
type BtDevice = {
  name?: string | null
  gatt?: GattServer
  addEventListener(type: "gattserverdisconnected", cb: (e: Event) => void): void
  removeEventListener(type: "gattserverdisconnected", cb: (e: Event) => void): void
}
type NavigatorBluetooth = {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean
      optionalServices?: Array<string | number>
    }): Promise<BtDevice>
  }
}

// Candidate GATT services for common BLE-serial caliper adapters. We call
// requestDevice with acceptAllDevices so the chooser lists every nearby device,
// but a service must appear here for getPrimaryServices() to be *allowed* to
// return it afterward. A caliper whose adapter uses a service not listed here
// will pair but report "no readable data channel" — add its UUID below.
const CALIPER_SERVICE_UUIDS: Array<string | number> = [
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART Service (NUS)
  0xffe0, // HM-10 / TI CC254x BLE-serial (char 0xffe1)
  0xfff0, // common vendor serial profile
  0xff00,
]

export type CaliperStatus = "idle" | "pairing" | "connected" | "error"

export type UseCaliper = {
  /** True once we've confirmed navigator.bluetooth exists (client-only). */
  supported: boolean
  status: CaliperStatus
  deviceName: string | null
  error: string | null
  pair: () => Promise<void>
  disconnect: () => void
}

/**
 * Connect to a Bluetooth caliper over Web Bluetooth and forward each decoded
 * reading to `onReading`. Isolated from the form so the measurement UI stays
 * agnostic about transport: a keyboard-wedge (HID) caliper types into the
 * focused field directly, while a BLE caliper routes through here. Feature
 * detection means the button is simply hidden on unsupported browsers.
 */
export function useCaliper(onReading: (value: number) => void): UseCaliper {
  const [status, setStatus] = useState<CaliperStatus>("idle")
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read the client-only capability without a hydration mismatch (server
  // snapshot is always false) and without a setState-in-effect. Support can't
  // change at runtime, so subscribe is a no-op.
  const supported = useSyncExternalStore(
    () => () => {},
    () =>
      typeof navigator !== "undefined" &&
      !!(navigator as unknown as NavigatorBluetooth).bluetooth,
    () => false,
  )

  const deviceRef = useRef<BtDevice | null>(null)
  const charRef = useRef<GattCharacteristic | null>(null)
  // Keep the latest callback in a ref so the GATT listener never closes over a
  // stale form state without us re-subscribing on every render.
  const onReadingRef = useRef(onReading)
  useEffect(() => {
    onReadingRef.current = onReading
  }, [onReading])

  const handleValue = useCallback((e: Event) => {
    const ch = e.target as unknown as GattCharacteristic
    const view = ch.value
    if (!view) return
    const text = new TextDecoder().decode(view.buffer)
    const reading = parseCaliperReading(text)
    if (reading != null) onReadingRef.current(reading)
  }, [])

  const teardown = useCallback(() => {
    const ch = charRef.current
    if (ch) {
      ch.removeEventListener("characteristicvaluechanged", handleValue)
      // stopNotifications can reject if the link already dropped — ignore.
      void ch.stopNotifications().catch(() => {})
      charRef.current = null
    }
  }, [handleValue])

  const handleDisconnect = useCallback(() => {
    teardown()
    setStatus("idle")
    setDeviceName(null)
  }, [teardown])

  const disconnect = useCallback(() => {
    teardown()
    const device = deviceRef.current
    device?.removeEventListener("gattserverdisconnected", handleDisconnect)
    device?.gatt?.disconnect()
    deviceRef.current = null
    setStatus("idle")
    setDeviceName(null)
    setError(null)
  }, [teardown, handleDisconnect])

  const pair = useCallback(async () => {
    const nav = navigator as unknown as NavigatorBluetooth
    if (!nav.bluetooth) return
    setError(null)
    setStatus("pairing")
    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: CALIPER_SERVICE_UUIDS,
      })
      deviceRef.current = device
      device.addEventListener("gattserverdisconnected", handleDisconnect)

      const server = await device.gatt?.connect()
      if (!server) throw new Error("Could not connect to the device.")

      // Scan the services we were granted access to for the first characteristic
      // that can stream values (notify/indicate), and subscribe to it.
      const services = await server.getPrimaryServices()
      let subscribed = false
      for (const svc of services) {
        const chars = await svc.getCharacteristics()
        for (const ch of chars) {
          if (ch.properties.notify || ch.properties.indicate) {
            await ch.startNotifications()
            ch.addEventListener("characteristicvaluechanged", handleValue)
            charRef.current = ch
            subscribed = true
            break
          }
        }
        if (subscribed) break
      }
      if (!subscribed) {
        throw new Error(
          "Paired, but this device exposes no readable data channel — it may use a vendor-specific format.",
        )
      }

      setDeviceName(device.name?.trim() || "Caliper")
      setStatus("connected")
    } catch (err) {
      // Dismissing the device chooser rejects with NotFoundError; treat that as
      // a quiet abort rather than an error state.
      const name = (err as { name?: string } | null)?.name
      if (name === "NotFoundError") {
        setStatus(charRef.current ? "connected" : "idle")
        return
      }
      setError((err as Error | null)?.message ?? "Pairing failed.")
      setStatus("error")
    }
  }, [handleDisconnect, handleValue])

  // Drop the connection if the form unmounts (navigating away after submit).
  useEffect(() => disconnect, [disconnect])

  return { supported, status, deviceName, error, pair, disconnect }
}

// Parity guard for the hand-copied retry policy in public/sw.js.
//
// The service worker is a classic (non-module) worker, so it cannot import
// src/lib/offline/retry-policy.ts and instead carries an inline mirror of the
// policy. Before this test, the only thing keeping the two copies in sync was
// a comment — retry-policy.test.ts pinned the .ts module, which NOTHING in
// production imports, while the live sw.js copy was untested. This test
// extracts the mirror block from sw.js source (delimited by the
// "BEGIN/END retry-policy mirror" markers), evaluates it in isolation, and
// asserts behavioral equality with the canonical module across the full input
// matrix. Editing either copy without the other now fails CI.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  classifyReplayResult,
  isTransientReplayStatus,
  MAX_REPLAY_RETRIES,
} from "./retry-policy"

const SW_PATH = join(__dirname, "../../../public/sw.js")

type SwPolicy = {
  MAX_REPLAY_RETRIES: number
  isTransientReplayStatus: (status: number | null) => boolean
  classifyReplayResult: (
    ok: boolean,
    status: number | null,
    retryCount: number,
    now: number
  ) => unknown
}

function loadSwMirror(): SwPolicy {
  const source = readFileSync(SW_PATH, "utf8")
  const match = source.match(
    /\/\/ BEGIN retry-policy mirror\n([\s\S]*?)\/\/ END retry-policy mirror/
  )
  if (!match) {
    throw new Error(
      "public/sw.js is missing the 'BEGIN/END retry-policy mirror' markers — " +
        "restore them around the inline retry-policy block"
    )
  }
  const factory = new Function(
    `${match[1]}
     return { MAX_REPLAY_RETRIES, isTransientReplayStatus, classifyReplayResult }`
  )
  return factory() as SwPolicy
}

// null = network error / fetch threw; the rest cover every status class the
// policy branches on, including each allow-listed transient 4xx, its
// permanent 4xx neighbors, and 5xx.
const STATUSES: Array<number | null> = [
  null, 200, 201, 301, 400, 401, 403, 404, 408, 409, 410, 422, 425, 429, 451,
  500, 502, 503, 599,
]
const RETRY_COUNTS = [0, 1, 2, 3, 4, 5, 6]
const NOW = 1_750_000_000_000

describe("sw.js retry-policy mirror parity", () => {
  const sw = loadSwMirror()

  it("agrees on MAX_REPLAY_RETRIES", () => {
    expect(sw.MAX_REPLAY_RETRIES).toBe(MAX_REPLAY_RETRIES)
  })

  it("agrees on isTransientReplayStatus for every status class", () => {
    for (const status of STATUSES) {
      expect(sw.isTransientReplayStatus(status), `status=${status}`).toBe(
        isTransientReplayStatus(status)
      )
    }
  })

  it("agrees on classifyReplayResult across the full matrix", () => {
    for (const ok of [true, false]) {
      for (const status of STATUSES) {
        for (const retryCount of RETRY_COUNTS) {
          expect(
            sw.classifyReplayResult(ok, status, retryCount, NOW),
            `ok=${ok} status=${status} retryCount=${retryCount}`
          ).toEqual(classifyReplayResult(ok, status, retryCount, NOW))
        }
      }
    }
  })
})

import { describe, expect, it } from "vitest"

import { isSafeExternalHttpUrl } from "./safe-external-url"

describe("isSafeExternalHttpUrl", () => {
  it("accepts ordinary public http(s) URLs", () => {
    expect(isSafeExternalHttpUrl("https://cdn.example.com/logo.png")).toBe(true)
    expect(isSafeExternalHttpUrl("http://example.org/a/b.svg")).toBe(true)
    expect(isSafeExternalHttpUrl("https://8.8.8.8/logo.png")).toBe(true) // public IP
  })

  it("rejects non-http(s) schemes", () => {
    expect(isSafeExternalHttpUrl("file:///etc/passwd")).toBe(false)
    expect(isSafeExternalHttpUrl("ftp://example.com/x")).toBe(false)
    expect(isSafeExternalHttpUrl("gopher://example.com/x")).toBe(false)
    expect(isSafeExternalHttpUrl("data:text/plain,hi")).toBe(false)
  })

  it("rejects unparseable input", () => {
    expect(isSafeExternalHttpUrl("not a url")).toBe(false)
    expect(isSafeExternalHttpUrl("")).toBe(false)
  })

  it("rejects localhost and loopback", () => {
    expect(isSafeExternalHttpUrl("http://localhost/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://sub.localhost/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://127.0.0.1/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://127.5.5.5:8080/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://[::1]/x")).toBe(false)
  })

  it("rejects the cloud metadata endpoint and link-local", () => {
    expect(isSafeExternalHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(false)
    expect(isSafeExternalHttpUrl("http://169.254.1.1/x")).toBe(false)
  })

  it("rejects RFC1918 private ranges", () => {
    expect(isSafeExternalHttpUrl("http://10.0.0.5:6379/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://172.16.0.1/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://172.31.255.255/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://192.168.1.1/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://0.0.0.0/x")).toBe(false)
  })

  it("does not falsely reject public IPs adjacent to private ranges", () => {
    expect(isSafeExternalHttpUrl("http://172.15.0.1/x")).toBe(true)
    expect(isSafeExternalHttpUrl("http://172.32.0.1/x")).toBe(true)
    expect(isSafeExternalHttpUrl("http://11.0.0.1/x")).toBe(true)
  })

  it("rejects IPv4-mapped IPv6 pointing at a private host", () => {
    expect(isSafeExternalHttpUrl("http://[::ffff:169.254.169.254]/x")).toBe(false)
    expect(isSafeExternalHttpUrl("http://[::ffff:10.0.0.1]/x")).toBe(false)
  })
})

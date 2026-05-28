"use client"

import * as React from "react"

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string }

const initialForm = {
  name: "",
  email: "",
  company: "",
  addressLine1: "",
  addressLine2: "",
  addressCity: "",
  addressRegion: "",
  addressPostal: "",
  addressCountry: "",
  note: "",
}

type FormState = typeof initialForm

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "17px 36px",
  borderRadius: "var(--radius-md)",
  background: "linear-gradient(180deg, #82CC36 0%, #69BE28 100%)",
  border: "none",
  color: "#002244",
  fontWeight: 700,
  fontSize: 17,
  textDecoration: "none",
  minHeight: 56,
  cursor: "pointer",
  boxShadow: "0 2px 0 0 #3F7C13, 0 4px 16px rgba(105,190,40,0.30)",
  letterSpacing: "0.01em",
}

export function RequestInformationButton({
  style,
  children = "Request Information",
}: {
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...PRIMARY_BUTTON_STYLE, ...style }}
      >
        {children}
      </button>
      {open ? <RequestInformationModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function RequestInformationModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = React.useState<FormState>(initialForm)
  const [status, setStatus] = React.useState<Status>({ kind: "idle" })

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus({ kind: "submitting" })
    try {
      const res = await fetch("/api/information-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        setStatus({
          kind: "error",
          message: data.error ?? "Something went wrong. Please try again.",
        })
        return
      }
      setStatus({ kind: "success" })
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Please try again.",
      })
    }
  }

  const submitting = status.kind === "submitting"
  const success = status.kind === "success"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-info-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "clamp(16px, 5vw, 60px) 16px",
        background: "rgba(0, 8, 24, 0.78)",
        backdropFilter: "blur(6px)",
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          background: "linear-gradient(180deg, #0d2547 0%, #0a1f3c 100%)",
          border: "1px solid #15315a",
          borderRadius: 18,
          padding: "clamp(24px, 4vw, 40px)",
          color: "#f9fafb",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          position: "relative",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 36,
            height: 36,
            borderRadius: "var(--radius-sm)",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#fff",
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>

        {success ? (
          <SuccessView onClose={onClose} />
        ) : (
          <>
            <h2
              id="request-info-title"
              style={{
                fontWeight: 800,
                fontSize: "clamp(22px, 3vw, 28px)",
                lineHeight: 1.2,
                margin: "0 0 8px",
                color: "#ffffff",
              }}
            >
              Request Information
            </h2>
            <p
              style={{
                color: "rgba(255,255,255,0.72)",
                fontSize: 15,
                margin: "0 0 24px",
                lineHeight: 1.55,
              }}
            >
              Tell us about your facility and we&apos;ll be in touch.
            </p>

            <form onSubmit={handleSubmit} noValidate>
              <FieldGrid>
                <Field
                  label="Full name"
                  required
                  id="rinfo-name"
                  value={form.name}
                  onChange={(v) => update("name", v)}
                  autoComplete="name"
                />
                <Field
                  label="Email"
                  required
                  type="email"
                  id="rinfo-email"
                  value={form.email}
                  onChange={(v) => update("email", v)}
                  autoComplete="email"
                />
              </FieldGrid>

              <Field
                label="Company or facility name"
                required
                id="rinfo-company"
                value={form.company}
                onChange={(v) => update("company", v)}
                autoComplete="organization"
              />

              <FieldsetHeader>Address</FieldsetHeader>

              <Field
                label="Street address"
                id="rinfo-line1"
                value={form.addressLine1}
                onChange={(v) => update("addressLine1", v)}
                autoComplete="address-line1"
              />
              <Field
                label="Apartment, suite, unit (optional)"
                id="rinfo-line2"
                value={form.addressLine2}
                onChange={(v) => update("addressLine2", v)}
                autoComplete="address-line2"
              />

              <FieldGrid>
                <Field
                  label="City"
                  id="rinfo-city"
                  value={form.addressCity}
                  onChange={(v) => update("addressCity", v)}
                  autoComplete="address-level2"
                />
                <Field
                  label="State / Province / Region"
                  id="rinfo-region"
                  value={form.addressRegion}
                  onChange={(v) => update("addressRegion", v)}
                  autoComplete="address-level1"
                />
              </FieldGrid>

              <FieldGrid>
                <Field
                  label="Postal / ZIP code"
                  id="rinfo-postal"
                  value={form.addressPostal}
                  onChange={(v) => update("addressPostal", v)}
                  autoComplete="postal-code"
                />
                <Field
                  label="Country"
                  required
                  id="rinfo-country"
                  value={form.addressCountry}
                  onChange={(v) => update("addressCountry", v)}
                  autoComplete="country-name"
                  placeholder="United States, Canada, …"
                />
              </FieldGrid>

              <Field
                label="What are you interested in?"
                id="rinfo-note"
                value={form.note}
                onChange={(v) => update("note", v)}
                multiline
                placeholder="Tell us about your rink, current pain points, or what you'd like to learn more about."
              />

              {status.kind === "error" ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255, 80, 80, 0.12)",
                    border: "1px solid rgba(255, 80, 80, 0.35)",
                    color: "#ffb4b4",
                    fontSize: 14,
                  }}
                >
                  {status.message}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 24,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  style={{
                    padding: "13px 22px",
                    borderRadius: "var(--radius-md)",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: submitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "13px 28px",
                    borderRadius: "var(--radius-md)",
                    background:
                      "linear-gradient(180deg, #82CC36 0%, #69BE28 100%)",
                    color: "#002244",
                    fontWeight: 700,
                    fontSize: 15,
                    border: "none",
                    boxShadow:
                      "0 2px 0 0 #3F7C13, 0 4px 16px rgba(105,190,40,0.30)",
                    cursor: submitting ? "wait" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? "Sending…" : "Send request"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function SuccessView({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "rgba(105,190,40,0.18)",
          display: "grid",
          placeItems: "center",
          margin: "0 auto 18px",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#82CC36"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h2
        style={{
          fontWeight: 800,
          fontSize: "clamp(22px, 3vw, 28px)",
          margin: "0 0 10px",
          color: "#ffffff",
        }}
      >
        Thanks — we&apos;ll be in touch
      </h2>
      <p
        style={{
          color: "rgba(255,255,255,0.72)",
          fontSize: 15,
          margin: "0 auto 24px",
          maxWidth: 380,
          lineHeight: 1.55,
        }}
      >
        We received your request and someone from Max Facility will follow up
        with you shortly.
      </p>
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: "13px 28px",
          borderRadius: "var(--radius-md)",
          background: "linear-gradient(180deg, #82CC36 0%, #69BE28 100%)",
          color: "#002244",
          fontWeight: 700,
          fontSize: 15,
          border: "none",
          boxShadow: "0 2px 0 0 #3F7C13, 0 4px 16px rgba(105,190,40,0.30)",
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  )
}

function FieldsetHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#82CC36",
        margin: "20px 0 8px",
      }}
    >
      {children}
    </div>
  )
}

type FieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  type?: string
  autoComplete?: string
  placeholder?: string
  multiline?: boolean
}

function Field({
  id,
  label,
  value,
  onChange,
  required,
  type = "text",
  autoComplete,
  placeholder,
  multiline,
}: FieldProps) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 13px",
    borderRadius: "var(--radius-sm)",
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          color: "rgba(255,255,255,0.78)",
          marginBottom: 6,
        }}
      >
        {label}
        {required ? <span style={{ color: "#82CC36" }}> *</span> : null}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </div>
  )
}

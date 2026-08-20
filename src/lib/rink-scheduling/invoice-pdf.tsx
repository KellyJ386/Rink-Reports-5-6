import "server-only"

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import React from "react"

import { formatMoney } from "./ar"

// Print-safe rendering of an invoice.
//
// Brand-appropriate but deliberately restrained: navy for structure, no large
// filled areas, and no neon on paper — #4DFF00 is a screen accent and prints
// as an unreadable wash. Numerics are monospaced so columns of money line up
// under each other, which is the whole reason an invoice is legible at a
// glance.

const NAVY = "#002244"
const RULE = "#C8D2DC"
const MUTED = "#54636F"

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#101820",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    paddingBottom: 12,
    marginBottom: 18,
  },
  facilityName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: NAVY },
  facilityMeta: { fontSize: 9, color: MUTED, marginTop: 3 },
  invoiceTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    textAlign: "right",
  },
  invoiceNumber: {
    fontSize: 11,
    fontFamily: "Courier-Bold",
    textAlign: "right",
    marginTop: 3,
  },
  statusChip: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textAlign: "right",
    marginTop: 4,
    letterSpacing: 1,
  },
  columns: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  block: { width: "48%" },
  blockLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 4,
  },
  blockLine: { fontSize: 10, marginBottom: 1 },
  datesRow: { flexDirection: "row", gap: 24, marginBottom: 18 },
  dateLabel: { fontSize: 8, color: MUTED, letterSpacing: 1 },
  dateValue: { fontSize: 10, fontFamily: "Courier", marginTop: 2 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    marginBottom: 4,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 1 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    paddingVertical: 5,
  },
  cDesc: { width: "52%", paddingRight: 8 },
  cQty: { width: "12%", textAlign: "right" },
  cRate: { width: "16%", textAlign: "right" },
  cAmt: { width: "20%", textAlign: "right" },
  mono: { fontFamily: "Courier" },
  totals: { marginTop: 14, alignSelf: "flex-end", width: "48%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 10, color: MUTED },
  totalValue: { fontSize: 10, fontFamily: "Courier" },
  dueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 2,
    borderTopColor: NAVY,
    marginTop: 6,
    paddingTop: 6,
  },
  dueLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  dueValue: { fontSize: 12, fontFamily: "Courier-Bold", color: NAVY },
  notesLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 3,
  },
  notes: { fontSize: 9, color: MUTED, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: RULE,
    paddingTop: 6,
    fontSize: 8,
    color: MUTED,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  voidBanner: {
    borderWidth: 2,
    borderColor: MUTED,
    padding: 6,
    marginBottom: 14,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 3,
  },
})

export type InvoicePdfData = {
  facility: {
    name: string
    address: string | null
    cityState: string | null
    zip: string | null
    phone: string | null
    email: string | null
  }
  customer: {
    name: string
    contactName: string | null
    line1: string | null
    line2: string | null
    cityStateZip: string | null
    email: string | null
  }
  invoiceNumber: string
  status: string
  issueDate: string
  dueDate: string
  paymentTerms: string
  lines: Array<{
    description: string
    quantityHours: string
    unitRate: string
    amount: string
  }>
  subtotal: string
  taxAmount: string | null
  total: string
  amountPaid: string
  amountDue: string
  notes: string | null
  generatedAt: string
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const isVoid = data.status === "void"

  return (
    <Document
      title={`Invoice ${data.invoiceNumber}`}
      author={data.facility.name}
      subject={`Invoice ${data.invoiceNumber} for ${data.customer.name}`}
    >
      <Page size="LETTER" style={styles.page}>
        {isVoid && <Text style={styles.voidBanner}>VOID</Text>}

        <View style={styles.headerRow}>
          <View style={{ width: "55%" }}>
            <Text style={styles.facilityName}>{data.facility.name}</Text>
            {data.facility.address && (
              <Text style={styles.facilityMeta}>{data.facility.address}</Text>
            )}
            {(data.facility.cityState || data.facility.zip) && (
              <Text style={styles.facilityMeta}>
                {[data.facility.cityState, data.facility.zip].filter(Boolean).join(" ")}
              </Text>
            )}
            {data.facility.phone && (
              <Text style={styles.facilityMeta}>{data.facility.phone}</Text>
            )}
            {data.facility.email && (
              <Text style={styles.facilityMeta}>{data.facility.email}</Text>
            )}
          </View>
          <View style={{ width: "40%" }}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            {data.status !== "sent" && (
              <Text style={styles.statusChip}>{data.status.replace(/_/g, " ").toUpperCase()}</Text>
            )}
          </View>
        </View>

        <View style={styles.columns}>
          <View style={styles.block}>
            <Text style={styles.blockLabel}>BILL TO</Text>
            <Text style={[styles.blockLine, { fontFamily: "Helvetica-Bold" }]}>
              {data.customer.name}
            </Text>
            {data.customer.contactName && (
              <Text style={styles.blockLine}>{data.customer.contactName}</Text>
            )}
            {data.customer.line1 && <Text style={styles.blockLine}>{data.customer.line1}</Text>}
            {data.customer.line2 && <Text style={styles.blockLine}>{data.customer.line2}</Text>}
            {data.customer.cityStateZip && (
              <Text style={styles.blockLine}>{data.customer.cityStateZip}</Text>
            )}
            {data.customer.email && <Text style={styles.blockLine}>{data.customer.email}</Text>}
          </View>
          <View style={styles.block}>
            <View style={styles.datesRow}>
              <View>
                <Text style={styles.dateLabel}>ISSUED</Text>
                <Text style={styles.dateValue}>{data.issueDate}</Text>
              </View>
              <View>
                <Text style={styles.dateLabel}>DUE</Text>
                <Text style={styles.dateValue}>{data.dueDate}</Text>
              </View>
            </View>
            <Text style={styles.dateLabel}>TERMS</Text>
            <Text style={[styles.blockLine, { marginTop: 2 }]}>{data.paymentTerms}</Text>
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.cDesc]}>DESCRIPTION</Text>
          <Text style={[styles.th, styles.cQty]}>HOURS</Text>
          <Text style={[styles.th, styles.cRate]}>RATE</Text>
          <Text style={[styles.th, styles.cAmt]}>AMOUNT</Text>
        </View>

        {data.lines.map((line, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.cDesc}>{line.description}</Text>
            <Text style={[styles.cQty, styles.mono]}>{line.quantityHours}</Text>
            <Text style={[styles.cRate, styles.mono]}>{line.unitRate}</Text>
            <Text style={[styles.cAmt, styles.mono]}>{line.amount}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{data.subtotal}</Text>
          </View>
          {data.taxAmount !== null && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{data.taxAmount}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{data.total}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Paid</Text>
            <Text style={styles.totalValue}>{data.amountPaid}</Text>
          </View>
          <View style={styles.dueRow}>
            <Text style={styles.dueLabel}>Amount due</Text>
            <Text style={styles.dueValue}>{data.amountDue}</Text>
          </View>
        </View>

        {data.notes && (
          <>
            <Text style={styles.notesLabel}>NOTES</Text>
            <Text style={styles.notes}>{data.notes}</Text>
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>{data.facility.name}</Text>
          <Text>
            {data.invoiceNumber} · generated {data.generatedAt}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

/** Money formatting for the PDF: the same cents-based helper the UI uses, so a
 *  printed invoice can never disagree with the screen. */
export function pdfMoney(value: number | string | null | undefined): string {
  return formatMoney(value)
}

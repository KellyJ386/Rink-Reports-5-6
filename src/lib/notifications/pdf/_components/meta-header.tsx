import "server-only"

import { StyleSheet, Text, View } from "@react-pdf/renderer"
import React from "react"

import { getCurrentTempForFacility } from "@/lib/weather/current-temp"
import { createClient } from "@/lib/supabase/server"

export type PdfMetaHeaderData = {
  userName: string
  submittedAt: string | null
  tempF: number | null
  tempLocation: string | null
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 3,
    marginBottom: 10,
  },
  metaCell: {
    flexDirection: "row",
    alignItems: "center",
    fontSize: 9,
    color: "#0f172a",
    marginRight: 12,
  },
  metaLabel: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginRight: 4,
  },
})

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function PdfMetaHeader({ data }: { data: PdfMetaHeaderData }) {
  const tempLabel =
    typeof data.tempF === "number"
      ? `${Math.round(data.tempF)}°F${data.tempLocation ? ` (${data.tempLocation})` : ""}`
      : "—"

  return (
    <View style={styles.metaRow}>
      <View style={styles.metaCell}>
        <Text style={styles.metaLabel}>User</Text>
        <Text>{data.userName}</Text>
      </View>
      <View style={styles.metaCell}>
        <Text style={styles.metaLabel}>Submitted</Text>
        <Text>{fmtDateTime(data.submittedAt)}</Text>
      </View>
      <View style={styles.metaCell}>
        <Text style={styles.metaLabel}>Temp</Text>
        <Text>{tempLabel}</Text>
      </View>
    </View>
  )
}

/**
 * Resolves the temperature + facility location for the meta header at
 * PDF render time. Best-effort: any failure returns null fields rather
 * than throwing, since the PDF must still render.
 */
export async function resolveMetaHeader(
  facilityId: string,
  submittedAt: string | null,
  userName: string,
): Promise<PdfMetaHeaderData> {
  const sb = await createClient()
  const { data: facility } = await sb
    .from("facilities")
    .select("city, state, zip_code")
    .eq("id", facilityId)
    .maybeSingle()

  const temp = facility ? await getCurrentTempForFacility(facility) : null
  return {
    userName,
    submittedAt,
    tempF: temp?.tempF ?? null,
    tempLocation: temp?.location ?? null,
  }
}

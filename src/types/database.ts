export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accident_body_part_selections: {
        Row: {
          accident_id: string
          body_part_dropdown_id: string
          created_at: string
          facility_id: string
          id: string
          notes: string | null
          side: string
          updated_at: string | null
        }
        Insert: {
          accident_id: string
          body_part_dropdown_id: string
          created_at?: string
          facility_id: string
          id?: string
          notes?: string | null
          side?: string
          updated_at?: string | null
        }
        Update: {
          accident_id?: string
          body_part_dropdown_id?: string
          created_at?: string
          facility_id?: string
          id?: string
          notes?: string | null
          side?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_body_part_selections_accident_id_fkey"
            columns: ["accident_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_body_part_selections_body_part_dropdown_id_fkey"
            columns: ["body_part_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_body_part_selections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_change_log: {
        Row: {
          accident_id: string
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
        }
        Insert: {
          accident_id: string
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
        }
        Update: {
          accident_id?: string
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accident_change_log_accident_id_fkey"
            columns: ["accident_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_change_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_change_log_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_dropdowns: {
        Row: {
          category: string
          color: string | null
          created_at: string
          display_name: string
          facility_id: string
          id: string
          is_active: boolean
          key: string
          metadata: Json
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          category: string
          color?: string | null
          created_at?: string
          display_name: string
          facility_id: string
          id?: string
          is_active?: boolean
          key: string
          metadata?: Json
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string
          display_name?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          key?: string
          metadata?: Json
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_dropdowns_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_followup_notes: {
        Row: {
          accident_id: string
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
        }
        Insert: {
          accident_id: string
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
        }
        Update: {
          accident_id?: string
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accident_followup_notes_accident_id_fkey"
            columns: ["accident_id"]
            isOneToOne: false
            referencedRelation: "accident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_reports: {
        Row: {
          activity_dropdown_id: string | null
          created_at: string
          description: string
          edit_window_ends_at: string
          employee_id: string | null
          facility_id: string
          id: string
          injured_person_contact: string
          injured_person_name: string
          location_dropdown_id: string | null
          medical_attention_dropdown_id: string | null
          occurred_at: string
          primary_injury_type_dropdown_id: string | null
          severity_dropdown_id: string | null
          submitted_at: string
          updated_at: string | null
          workers_comp: boolean
          workers_comp_acknowledged_at: string | null
        }
        Insert: {
          activity_dropdown_id?: string | null
          created_at?: string
          description: string
          edit_window_ends_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          injured_person_contact: string
          injured_person_name: string
          location_dropdown_id?: string | null
          medical_attention_dropdown_id?: string | null
          occurred_at?: string
          primary_injury_type_dropdown_id?: string | null
          severity_dropdown_id?: string | null
          submitted_at?: string
          updated_at?: string | null
          workers_comp?: boolean
          workers_comp_acknowledged_at?: string | null
        }
        Update: {
          activity_dropdown_id?: string | null
          created_at?: string
          description?: string
          edit_window_ends_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          injured_person_contact?: string
          injured_person_name?: string
          location_dropdown_id?: string | null
          medical_attention_dropdown_id?: string | null
          occurred_at?: string
          primary_injury_type_dropdown_id?: string | null
          severity_dropdown_id?: string | null
          submitted_at?: string
          updated_at?: string | null
          workers_comp?: boolean
          workers_comp_acknowledged_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_reports_activity_dropdown_id_fkey"
            columns: ["activity_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_location_dropdown_id_fkey"
            columns: ["location_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_medical_attention_dropdown_id_fkey"
            columns: ["medical_attention_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_primary_injury_type_dropdown_id_fkey"
            columns: ["primary_injury_type_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accident_reports_severity_dropdown_id_fkey"
            columns: ["severity_dropdown_id"]
            isOneToOne: false
            referencedRelation: "accident_dropdowns"
            referencedColumns: ["id"]
          },
        ]
      }
      accident_workers_comp_settings: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          instructions: string
          is_active: boolean
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          instructions?: string
          is_active?: boolean
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          instructions?: string
          is_active?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accident_workers_comp_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_compliance_rules: {
        Row: {
          created_at: string
          effective_from: string | null
          effective_to: string | null
          facility_id: string
          id: string
          is_active: boolean
          jurisdiction: string
          rule_body: string
          rule_name: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          jurisdiction: string
          rule_body: string
          rule_name: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          jurisdiction?: string
          rule_body?: string
          rule_name?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_compliance_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_equipment: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          location_id: string | null
          model: string | null
          name: string
          serial_number: string | null
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          model?: string | null
          name: string
          serial_number?: string | null
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          model?: string | null
          name?: string
          serial_number?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_equipment_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_equipment_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "air_quality_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_followup_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          is_admin_note: boolean
          report_id: string
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          is_admin_note?: boolean
          report_id: string
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          is_admin_note?: boolean
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_followup_notes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "air_quality_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_locations: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_reading_types: {
        Row: {
          created_at: string
          decimals: number
          facility_id: string
          id: string
          is_active: boolean
          is_required: boolean
          key: string
          label: string
          sort_order: number
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          decimals?: number
          facility_id: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          key: string
          label: string
          sort_order?: number
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          decimals?: number
          facility_id?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          key?: string
          label?: string
          sort_order?: number
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_reading_types_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_readings: {
        Row: {
          compliance_max_at_submit: number | null
          compliance_min_at_submit: number | null
          created_at: string
          facility_id: string
          id: string
          is_exceedance: boolean
          key_snapshot: string
          label_snapshot: string
          reading_type_id: string | null
          report_id: string
          severity_at_submit: string | null
          threshold_id: string | null
          unit_snapshot: string
          value_numeric: number
        }
        Insert: {
          compliance_max_at_submit?: number | null
          compliance_min_at_submit?: number | null
          created_at?: string
          facility_id: string
          id?: string
          is_exceedance?: boolean
          key_snapshot: string
          label_snapshot: string
          reading_type_id?: string | null
          report_id: string
          severity_at_submit?: string | null
          threshold_id?: string | null
          unit_snapshot: string
          value_numeric: number
        }
        Update: {
          compliance_max_at_submit?: number | null
          compliance_min_at_submit?: number | null
          created_at?: string
          facility_id?: string
          id?: string
          is_exceedance?: boolean
          key_snapshot?: string
          label_snapshot?: string
          reading_type_id?: string | null
          report_id?: string
          severity_at_submit?: string | null
          threshold_id?: string | null
          unit_snapshot?: string
          value_numeric?: number
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_readings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_readings_reading_type_id_fkey"
            columns: ["reading_type_id"]
            isOneToOne: false
            referencedRelation: "air_quality_reading_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_readings_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "air_quality_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_readings_threshold_id_fkey"
            columns: ["threshold_id"]
            isOneToOne: false
            referencedRelation: "air_quality_thresholds"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_reports: {
        Row: {
          created_at: string
          employee_id: string | null
          equipment_id: string | null
          facility_id: string
          has_exceedance: boolean
          id: string
          location_id: string
          max_severity: string | null
          notes: string | null
          submitted_at: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          equipment_id?: string | null
          facility_id: string
          has_exceedance?: boolean
          id?: string
          location_id: string
          max_severity?: string | null
          notes?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          equipment_id?: string | null
          facility_id?: string
          has_exceedance?: boolean
          id?: string
          location_id?: string
          max_severity?: string | null
          notes?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_reports_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "air_quality_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_reports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_reports_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "air_quality_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_settings: {
        Row: {
          alerts_enabled: boolean
          created_at: string
          default_alert_severity: string
          default_jurisdiction: string | null
          facility_id: string
          id: string
          testing_frequency: string | null
          updated_at: string | null
        }
        Insert: {
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          default_jurisdiction?: string | null
          facility_id: string
          id?: string
          testing_frequency?: string | null
          updated_at?: string | null
        }
        Update: {
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          default_jurisdiction?: string | null
          facility_id?: string
          id?: string
          testing_frequency?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      air_quality_thresholds: {
        Row: {
          alert_max: number | null
          alert_min: number | null
          compliance_max: number | null
          compliance_min: number | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          location_id: string | null
          reading_type_id: string
          severity: string
          updated_at: string | null
          warn_max: number | null
          warn_min: number | null
        }
        Insert: {
          alert_max?: number | null
          alert_min?: number | null
          compliance_max?: number | null
          compliance_min?: number | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          reading_type_id: string
          severity?: string
          updated_at?: string | null
          warn_max?: number | null
          warn_min?: number | null
        }
        Update: {
          alert_max?: number | null
          alert_min?: number | null
          compliance_max?: number | null
          compliance_min?: number | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          reading_type_id?: string
          severity?: string
          updated_at?: string | null
          warn_max?: number | null
          warn_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "air_quality_thresholds_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_thresholds_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "air_quality_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "air_quality_thresholds_reading_type_id_fkey"
            columns: ["reading_type_id"]
            isOneToOne: false
            referencedRelation: "air_quality_reading_types"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_employee_id: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          facility_id: string
          id: string
          ip: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          facility_id: string
          id?: string
          ip?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          facility_id?: string
          id?: string
          ip?: unknown
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_acknowledgements: {
        Row: {
          acknowledged_at: string
          alert_id: string | null
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          message_id: string | null
          notes: string | null
        }
        Insert: {
          acknowledged_at?: string
          alert_id?: string | null
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          message_id?: string | null
          notes?: string | null
        }
        Update: {
          acknowledged_at?: string
          alert_id?: string | null
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          message_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_acknowledgements_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "communication_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_acknowledgements_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_acknowledgements_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_alerts: {
        Row: {
          area_id: string | null
          body: string | null
          created_at: string
          created_by_employee_id: string | null
          facility_id: string
          id: string
          requires_acknowledgement: boolean
          resolved_at: string | null
          resolved_by_employee_id: string | null
          severity: string
          source_module: string
          source_record_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          area_id?: string | null
          body?: string | null
          created_at?: string
          created_by_employee_id?: string | null
          facility_id: string
          id?: string
          requires_acknowledgement?: boolean
          resolved_at?: string | null
          resolved_by_employee_id?: string | null
          severity: string
          source_module: string
          source_record_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          area_id?: string | null
          body?: string | null
          created_at?: string
          created_by_employee_id?: string | null
          facility_id?: string
          id?: string
          requires_acknowledgement?: boolean
          resolved_at?: string | null
          resolved_by_employee_id?: string | null
          severity?: string
          source_module?: string
          source_record_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_alerts_created_by_employee_id_fkey"
            columns: ["created_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_alerts_resolved_by_employee_id_fkey"
            columns: ["resolved_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_audit_log: {
        Row: {
          action: string
          actor_employee_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          facility_id: string
          id: string
          ip: unknown
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          facility_id: string
          id?: string
          ip?: unknown
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          facility_id?: string
          id?: string
          ip?: unknown
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_audit_log_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_audit_log_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_group_members: {
        Row: {
          created_at: string
          employee_id: string
          facility_id: string
          group_id: string
          id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          facility_id: string
          group_id: string
          id?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          facility_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_group_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_group_members_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "communication_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_groups: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_groups_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_messages: {
        Row: {
          body: string
          created_at: string
          facility_id: string
          id: string
          requires_acknowledgement: boolean
          sender_employee_id: string | null
          sent_at: string
          subject: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string
          facility_id: string
          id?: string
          requires_acknowledgement?: boolean
          sender_employee_id?: string | null
          sent_at?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          facility_id?: string
          id?: string
          requires_acknowledgement?: boolean
          sender_employee_id?: string | null
          sent_at?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_messages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_messages_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_recipients: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          delivered_at: string | null
          employee_id: string
          facility_id: string
          id: string
          message_id: string
          read_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          delivered_at?: string | null
          employee_id: string
          facility_id: string
          id?: string
          message_id: string
          read_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          delivered_at?: string | null
          employee_id?: string
          facility_id?: string
          id?: string
          message_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_recipients_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_recipients_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_recurring_reminders: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string
          next_run_at: string | null
          schedule_cron: string
          target_group_id: string | null
          target_role_key: string | null
          template_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          schedule_cron: string
          target_group_id?: string | null
          target_role_key?: string | null
          template_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          schedule_cron?: string
          target_group_id?: string | null
          target_role_key?: string | null
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_recurring_reminders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_recurring_reminders_target_group_id_fkey"
            columns: ["target_group_id"]
            isOneToOne: false
            referencedRelation: "communication_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_recurring_reminders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_routing_rules: {
        Row: {
          area_id: string | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string | null
          priority: number
          severity: string | null
          source_module: string
          target_employee_id: string | null
          target_group_id: string | null
          target_role_key: string | null
          updated_at: string | null
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name?: string | null
          priority?: number
          severity?: string | null
          source_module: string
          target_employee_id?: string | null
          target_group_id?: string | null
          target_role_key?: string | null
          updated_at?: string | null
        }
        Update: {
          area_id?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string | null
          priority?: number
          severity?: string | null
          source_module?: string
          target_employee_id?: string | null
          target_group_id?: string | null
          target_role_key?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_routing_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_routing_rules_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_routing_rules_target_group_id_fkey"
            columns: ["target_group_id"]
            isOneToOne: false
            referencedRelation: "communication_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          requires_acknowledgement: boolean
          slug: string
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          requires_acknowledgement?: boolean
          slug: string
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          requires_acknowledgement?: boolean
          slug?: string
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_areas: {
        Row: {
          color: string | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_areas_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_checklist_items: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          template_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          template_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_checklist_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "daily_report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          is_admin_note: boolean
          submission_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          is_admin_note?: boolean
          submission_id: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          is_admin_note?: boolean
          submission_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_notes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "daily_report_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_submission_items: {
        Row: {
          checklist_item_id: string | null
          created_at: string
          facility_id: string
          id: string
          is_checked: boolean
          label_snapshot: string
          submission_id: string
        }
        Insert: {
          checklist_item_id?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_checked?: boolean
          label_snapshot: string
          submission_id: string
        }
        Update: {
          checklist_item_id?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_checked?: boolean
          label_snapshot?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_submission_items_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "daily_report_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_submission_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_submission_items_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "daily_report_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_submissions: {
        Row: {
          area_id: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          submitted_at: string
          template_id: string
          updated_at: string | null
        }
        Insert: {
          area_id: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          submitted_at?: string
          template_id: string
          updated_at?: string | null
        }
        Update: {
          area_id?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          submitted_at?: string
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_submissions_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "daily_report_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_submissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_submissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_submissions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "daily_report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_templates: {
        Row: {
          area_id: string
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          area_id: string
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          area_id?: string
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_templates_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "daily_report_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          color: string | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_departments: {
        Row: {
          created_at: string
          department_id: string
          employee_id: string
          facility_id: string
          id: string
          is_primary: boolean
        }
        Insert: {
          created_at?: string
          department_id: string
          employee_id: string
          facility_id: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          created_at?: string
          department_id?: string
          employee_id?: string
          facility_id?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "employee_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_departments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_departments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_code: string | null
          facility_id: string
          first_name: string
          hire_date: string | null
          id: string
          is_active: boolean
          is_minor: boolean
          last_name: string
          phone: string | null
          role_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          facility_id: string
          first_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          is_minor?: boolean
          last_name: string
          phone?: string | null
          role_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          facility_id?: string
          first_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          is_minor?: boolean
          last_name?: string
          phone?: string | null
          role_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      export_settings: {
        Row: {
          created_at: string
          facility_id: string
          footer_text: string | null
          header_text: string | null
          id: string
          include_date: boolean
          include_facility_name: boolean
          include_submitted_by: boolean
          logo_url: string | null
          paper_size: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          footer_text?: string | null
          header_text?: string | null
          id?: string
          include_date?: boolean
          include_facility_name?: boolean
          include_submitted_by?: boolean
          logo_url?: string | null
          paper_size?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          footer_text?: string | null
          header_text?: string | null
          id?: string
          include_date?: boolean
          include_facility_name?: boolean
          include_submitted_by?: boolean
          logo_url?: string | null
          paper_size?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ice_depth_followup_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          is_admin_note: boolean
          session_id: string
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          is_admin_note?: boolean
          session_id: string
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          is_admin_note?: boolean
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_followup_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ice_depth_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_depth_layouts: {
        Row: {
          created_at: string
          description: string | null
          diagram_aspect_ratio: number
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          diagram_aspect_ratio?: number
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          diagram_aspect_ratio?: number
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_layouts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_depth_measurements: {
        Row: {
          created_at: string
          depth_value: number
          facility_id: string
          id: string
          label_snapshot: string | null
          point_id: string | null
          point_number_snapshot: number
          session_id: string
          severity: string
          x_snapshot: number
          y_snapshot: number
        }
        Insert: {
          created_at?: string
          depth_value: number
          facility_id: string
          id?: string
          label_snapshot?: string | null
          point_id?: string | null
          point_number_snapshot: number
          session_id: string
          severity: string
          x_snapshot: number
          y_snapshot: number
        }
        Update: {
          created_at?: string
          depth_value?: number
          facility_id?: string
          id?: string
          label_snapshot?: string | null
          point_id?: string | null
          point_number_snapshot?: number
          session_id?: string
          severity?: string
          x_snapshot?: number
          y_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_measurements_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_measurements_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "ice_depth_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_measurements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ice_depth_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_depth_points: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          label: string | null
          layout_id: string
          point_number: number
          sort_order: number
          updated_at: string | null
          x_position: number
          y_position: number
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          label?: string | null
          layout_id: string
          point_number: number
          sort_order?: number
          updated_at?: string | null
          x_position: number
          y_position: number
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          label?: string | null
          layout_id?: string
          point_number?: number
          sort_order?: number
          updated_at?: string | null
          x_position?: number
          y_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_points_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_points_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "ice_depth_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_depth_sessions: {
        Row: {
          created_at: string
          employee_id: string | null
          facility_id: string
          has_high_reading: boolean
          has_low_reading: boolean
          high_count: number
          high_threshold_snapshot: number
          id: string
          layout_id: string
          low_count: number
          low_threshold_snapshot: number
          measurement_unit_snapshot: string
          notes: string | null
          submitted_at: string
          total_measurements: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          facility_id: string
          has_high_reading?: boolean
          has_low_reading?: boolean
          high_count?: number
          high_threshold_snapshot: number
          id?: string
          layout_id: string
          low_count?: number
          low_threshold_snapshot: number
          measurement_unit_snapshot: string
          notes?: string | null
          submitted_at?: string
          total_measurements?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          has_high_reading?: boolean
          has_low_reading?: boolean
          high_count?: number
          high_threshold_snapshot?: number
          id?: string
          layout_id?: string
          low_count?: number
          low_threshold_snapshot?: number
          measurement_unit_snapshot?: string
          notes?: string | null
          submitted_at?: string
          total_measurements?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_depth_sessions_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "ice_depth_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_depth_settings: {
        Row: {
          alert_on: string
          alerts_enabled: boolean
          created_at: string
          default_alert_severity: string
          facility_id: string
          high_color: string
          high_threshold: number
          id: string
          low_color: string
          low_threshold: number
          measurement_unit: string
          ok_color: string
          updated_at: string | null
        }
        Insert: {
          alert_on?: string
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          facility_id: string
          high_color?: string
          high_threshold?: number
          id?: string
          low_color?: string
          low_threshold?: number
          measurement_unit?: string
          ok_color?: string
          updated_at?: string | null
        }
        Update: {
          alert_on?: string
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          facility_id?: string
          high_color?: string
          high_threshold?: number
          id?: string
          low_color?: string
          low_threshold?: number
          measurement_unit?: string
          ok_color?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_depth_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_circle_check_items: {
        Row: {
          applies_to_equipment_type: string | null
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          applies_to_equipment_type?: string | null
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          applies_to_equipment_type?: string | null
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_circle_check_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_circle_check_results: {
        Row: {
          checklist_item_id: string | null
          created_at: string
          facility_id: string
          failed_notes: string | null
          id: string
          label_snapshot: string
          passed: boolean
          submission_id: string
        }
        Insert: {
          checklist_item_id?: string | null
          created_at?: string
          facility_id: string
          failed_notes?: string | null
          id?: string
          label_snapshot: string
          passed: boolean
          submission_id: string
        }
        Update: {
          checklist_item_id?: string | null
          created_at?: string
          facility_id?: string
          failed_notes?: string | null
          id?: string
          label_snapshot?: string
          passed?: boolean
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_circle_check_results_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "ice_operations_circle_check_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_circle_check_results_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_circle_check_results_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ice_operations_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_equipment: {
        Row: {
          created_at: string
          equipment_type: string
          facility_id: string
          hours_count: number | null
          id: string
          is_active: boolean
          model: string | null
          name: string
          serial_number: string | null
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          equipment_type: string
          facility_id: string
          hours_count?: number | null
          id?: string
          is_active?: boolean
          model?: string | null
          name: string
          serial_number?: string | null
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          equipment_type?: string
          facility_id?: string
          hours_count?: number | null
          id?: string
          is_active?: boolean
          model?: string | null
          name?: string
          serial_number?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_equipment_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_followup_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          is_admin_note: boolean
          submission_id: string
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          is_admin_note?: boolean
          submission_id: string
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          is_admin_note?: boolean
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_followup_notes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ice_operations_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_rinks: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_rinks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_settings: {
        Row: {
          alerts_enabled: boolean
          created_at: string
          default_alert_severity: string
          facility_id: string
          id: string
          temperature_unit: string
          updated_at: string | null
        }
        Insert: {
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          facility_id: string
          id?: string
          temperature_unit?: string
          updated_at?: string | null
        }
        Update: {
          alerts_enabled?: boolean
          created_at?: string
          default_alert_severity?: string
          facility_id?: string
          id?: string
          temperature_unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      ice_operations_submissions: {
        Row: {
          created_at: string
          employee_id: string | null
          equipment_id: string | null
          facility_id: string
          failed_count: number
          has_failed_check: boolean
          id: string
          notes: string | null
          occurred_at: string
          operation_type: string
          payload: Json
          rink_id: string | null
          submitted_at: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          equipment_id?: string | null
          facility_id: string
          failed_count?: number
          has_failed_check?: boolean
          id?: string
          notes?: string | null
          occurred_at?: string
          operation_type: string
          payload?: Json
          rink_id?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          equipment_id?: string | null
          facility_id?: string
          failed_count?: number
          has_failed_check?: boolean
          id?: string
          notes?: string | null
          occurred_at?: string
          operation_type?: string
          payload?: Json
          rink_id?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ice_operations_submissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_submissions_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "ice_operations_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_submissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ice_operations_submissions_rink_id_fkey"
            columns: ["rink_id"]
            isOneToOne: false
            referencedRelation: "ice_operations_rinks"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_followup_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          incident_id: string
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          incident_id: string
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_followup_notes_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incident_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_reports: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string
          employee_id: string | null
          facility_id: string
          id: string
          incident_type_id: string | null
          location: string | null
          occurred_at: string
          reporter_name: string
          reporter_phone: string
          resolved_at: string | null
          reviewed_at: string | null
          severity_level_id: string | null
          status: string
          submitted_at: string
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description: string
          employee_id?: string | null
          facility_id: string
          id?: string
          incident_type_id?: string | null
          location?: string | null
          occurred_at?: string
          reporter_name: string
          reporter_phone: string
          resolved_at?: string | null
          reviewed_at?: string | null
          severity_level_id?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          incident_type_id?: string | null
          location?: string | null
          occurred_at?: string
          reporter_name?: string
          reporter_phone?: string
          resolved_at?: string | null
          reviewed_at?: string | null
          severity_level_id?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_incident_type_id_fkey"
            columns: ["incident_type_id"]
            isOneToOne: false
            referencedRelation: "incident_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_severity_level_id_fkey"
            columns: ["severity_level_id"]
            isOneToOne: false
            referencedRelation: "incident_severity_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_severity_levels: {
        Row: {
          color: string | null
          created_at: string
          display_name: string
          facility_id: string
          id: string
          is_active: boolean
          key: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_name: string
          facility_id: string
          id?: string
          is_active?: boolean
          key: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          display_name?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          key?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_severity_levels_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_types: {
        Row: {
          color: string | null
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_types_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      module_area_permissions: {
        Row: {
          area_id: string
          can_submit: boolean
          can_view: boolean
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          module_key: string
        }
        Insert: {
          area_id: string
          can_submit?: boolean
          can_view?: boolean
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          module_key: string
        }
        Update: {
          area_id?: string
          can_submit?: boolean
          can_view?: boolean
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_area_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_area_permissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      module_permissions: {
        Row: {
          can_admin: boolean
          can_submit: boolean
          can_view: boolean
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          module_key: string
          updated_at: string | null
        }
        Insert: {
          can_admin?: boolean
          can_submit?: boolean
          can_view?: boolean
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          module_key: string
          updated_at?: string | null
        }
        Update: {
          can_admin?: boolean
          can_submit?: boolean
          can_view?: boolean
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          module_key?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "module_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_permissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_equipment: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          section_id: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          section_id: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          section_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_equipment_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_equipment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_fields: {
        Row: {
          created_at: string
          equipment_id: string | null
          facility_id: string
          field_type: string
          id: string
          is_active: boolean
          key: string
          label: string
          options: Json
          section_id: string
          sort_order: number
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          equipment_id?: string | null
          facility_id: string
          field_type: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          options?: Json
          section_id: string
          sort_order?: number
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          equipment_id?: string | null
          facility_id?: string
          field_type?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          options?: Json
          section_id?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_fields_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_fields_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_followup_notes: {
        Row: {
          body: string
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          is_admin_note: boolean
          report_id: string
        }
        Insert: {
          body: string
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          is_admin_note?: boolean
          report_id: string
        }
        Update: {
          body?: string
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          is_admin_note?: boolean
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_followup_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_followup_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_followup_notes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_report_values: {
        Row: {
          created_at: string
          equipment_id: string | null
          equipment_name_snapshot: string | null
          facility_id: string
          field_id: string | null
          field_type_snapshot: string
          id: string
          is_out_of_range: boolean
          label_snapshot: string
          report_id: string
          threshold_id: string | null
          unit_snapshot: string | null
          value_boolean: boolean | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          equipment_id?: string | null
          equipment_name_snapshot?: string | null
          facility_id: string
          field_id?: string | null
          field_type_snapshot: string
          id?: string
          is_out_of_range?: boolean
          label_snapshot: string
          report_id: string
          threshold_id?: string | null
          unit_snapshot?: string | null
          value_boolean?: boolean | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          equipment_id?: string | null
          equipment_name_snapshot?: string | null
          facility_id?: string
          field_id?: string | null
          field_type_snapshot?: string
          id?: string
          is_out_of_range?: boolean
          label_snapshot?: string
          report_id?: string
          threshold_id?: string | null
          unit_snapshot?: string | null
          value_boolean?: boolean | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_report_values_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_report_values_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_report_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_report_values_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_report_values_threshold_id_fkey"
            columns: ["threshold_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_thresholds"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_reports: {
        Row: {
          created_at: string
          employee_id: string | null
          facility_id: string
          id: string
          notes: string | null
          submitted_at: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          submitted_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_reports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_sections: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_sections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_settings: {
        Row: {
          created_at: string
          default_alert_severity: string
          facility_id: string
          id: string
          out_of_range_alerts_enabled: boolean
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          default_alert_severity?: string
          facility_id: string
          id?: string
          out_of_range_alerts_enabled?: boolean
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          default_alert_severity?: string
          facility_id?: string
          id?: string
          out_of_range_alerts_enabled?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigeration_thresholds: {
        Row: {
          created_at: string
          equipment_id: string | null
          facility_id: string
          field_id: string
          id: string
          is_active: boolean
          max_value: number | null
          min_value: number | null
          severity: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          equipment_id?: string | null
          facility_id: string
          field_id: string
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          severity?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          equipment_id?: string | null
          facility_id?: string
          field_id?: string
          id?: string
          is_active?: boolean
          max_value?: number | null
          min_value?: number | null
          severity?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refrigeration_thresholds_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_thresholds_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refrigeration_thresholds_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "refrigeration_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_settings: {
        Row: {
          auto_purge: boolean
          created_at: string
          facility_id: string
          id: string
          keep_days: number
          module_key: string
          updated_at: string | null
        }
        Insert: {
          auto_purge?: boolean
          created_at?: string
          facility_id: string
          id?: string
          keep_days?: number
          module_key: string
          updated_at?: string | null
        }
        Update: {
          auto_purge?: boolean
          created_at?: string
          facility_id?: string
          id?: string
          keep_days?: number
          module_key?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          display_name: string
          facility_id: string
          hierarchy_level: number
          id: string
          is_system: boolean
          key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          facility_id: string
          hierarchy_level: number
          id?: string
          is_system?: boolean
          key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          facility_id?: string
          hierarchy_level?: number
          id?: string
          is_system?: boolean
          key?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_availability: {
        Row: {
          availability_type: string
          created_at: string
          day_of_week: number
          effective_from: string | null
          effective_to: string | null
          employee_id: string
          end_time: string
          facility_id: string
          id: string
          notes: string | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          availability_type?: string
          created_at?: string
          day_of_week: number
          effective_from?: string | null
          effective_to?: string | null
          employee_id: string
          end_time: string
          facility_id: string
          id?: string
          notes?: string | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          availability_type?: string
          created_at?: string
          day_of_week?: number
          effective_from?: string | null
          effective_to?: string | null
          employee_id?: string
          end_time?: string
          facility_id?: string
          id?: string
          notes?: string | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_availability_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_compliance_rules: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          params: Json
          rule_type: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          params?: Json
          rule_type: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          params?: Json
          rule_type?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_compliance_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_notifications: {
        Row: {
          created_at: string
          employee_id: string
          facility_id: string
          id: string
          notification_type: string
          payload: Json
          read_at: string | null
          shift_id: string | null
          swap_id: string | null
          time_off_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          facility_id: string
          id?: string
          notification_type: string
          payload?: Json
          read_at?: string | null
          shift_id?: string | null
          swap_id?: string | null
          time_off_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          facility_id?: string
          id?: string
          notification_type?: string
          payload?: Json
          read_at?: string | null
          shift_id?: string | null
          swap_id?: string | null
          time_off_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_notifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_notifications_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "schedule_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_notifications_swap_id_fkey"
            columns: ["swap_id"]
            isOneToOne: false
            referencedRelation: "schedule_swap_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_notifications_time_off_id_fkey"
            columns: ["time_off_id"]
            isOneToOne: false
            referencedRelation: "schedule_time_off_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_open_shifts: {
        Row: {
          approval_required: boolean
          approved_at: string | null
          approved_by_employee_id: string | null
          claim_status: string
          claimed_at: string | null
          claimed_by_employee_id: string | null
          created_at: string
          expires_at: string | null
          facility_id: string
          id: string
          shift_id: string
          updated_at: string | null
        }
        Insert: {
          approval_required?: boolean
          approved_at?: string | null
          approved_by_employee_id?: string | null
          claim_status?: string
          claimed_at?: string | null
          claimed_by_employee_id?: string | null
          created_at?: string
          expires_at?: string | null
          facility_id: string
          id?: string
          shift_id: string
          updated_at?: string | null
        }
        Update: {
          approval_required?: boolean
          approved_at?: string | null
          approved_by_employee_id?: string | null
          claim_status?: string
          claimed_at?: string | null
          claimed_by_employee_id?: string | null
          created_at?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          shift_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_open_shifts_approved_by_employee_id_fkey"
            columns: ["approved_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_open_shifts_claimed_by_employee_id_fkey"
            columns: ["claimed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_open_shifts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_open_shifts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "schedule_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_publish_events: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          notes: string | null
          published_by_employee_id: string | null
          range_ends_at: string
          range_starts_at: string
          shift_count: number
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          notes?: string | null
          published_by_employee_id?: string | null
          range_ends_at: string
          range_starts_at: string
          shift_count: number
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          notes?: string | null
          published_by_employee_id?: string | null
          range_ends_at?: string
          range_starts_at?: string
          shift_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_publish_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_publish_events_published_by_employee_id_fkey"
            columns: ["published_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_settings: {
        Row: {
          created_at: string
          default_shift_minutes: number
          facility_id: string
          id: string
          minimum_break_after_hours: number | null
          minimum_break_minutes: number | null
          minor_max_weekly_hours: number | null
          notify_on_overtime: boolean
          notify_on_publish: boolean
          open_shift_first_come: boolean
          overtime_weekly_hours: number | null
          swap_requires_manager_approval: boolean
          updated_at: string | null
          week_start_day: number
        }
        Insert: {
          created_at?: string
          default_shift_minutes?: number
          facility_id: string
          id?: string
          minimum_break_after_hours?: number | null
          minimum_break_minutes?: number | null
          minor_max_weekly_hours?: number | null
          notify_on_overtime?: boolean
          notify_on_publish?: boolean
          open_shift_first_come?: boolean
          overtime_weekly_hours?: number | null
          swap_requires_manager_approval?: boolean
          updated_at?: string | null
          week_start_day?: number
        }
        Update: {
          created_at?: string
          default_shift_minutes?: number
          facility_id?: string
          id?: string
          minimum_break_after_hours?: number | null
          minimum_break_minutes?: number | null
          minor_max_weekly_hours?: number | null
          notify_on_overtime?: boolean
          notify_on_publish?: boolean
          open_shift_first_come?: boolean
          overtime_weekly_hours?: number | null
          swap_requires_manager_approval?: boolean
          updated_at?: string | null
          week_start_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_shifts: {
        Row: {
          break_minutes: number | null
          compliance_warnings: Json
          created_at: string
          department_id: string
          employee_id: string | null
          ends_at: string
          facility_id: string
          id: string
          notes: string | null
          published_at: string | null
          published_by_employee_id: string | null
          recurring_parent_id: string | null
          role_label: string | null
          starts_at: string
          status: string
          template_origin_id: string | null
          updated_at: string | null
        }
        Insert: {
          break_minutes?: number | null
          compliance_warnings?: Json
          created_at?: string
          department_id: string
          employee_id?: string | null
          ends_at: string
          facility_id: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by_employee_id?: string | null
          recurring_parent_id?: string | null
          role_label?: string | null
          starts_at: string
          status?: string
          template_origin_id?: string | null
          updated_at?: string | null
        }
        Update: {
          break_minutes?: number | null
          compliance_warnings?: Json
          created_at?: string
          department_id?: string
          employee_id?: string | null
          ends_at?: string
          facility_id?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by_employee_id?: string | null
          recurring_parent_id?: string | null
          role_label?: string | null
          starts_at?: string
          status?: string
          template_origin_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_published_by_employee_id_fkey"
            columns: ["published_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_recurring_parent_id_fkey"
            columns: ["recurring_parent_id"]
            isOneToOne: false
            referencedRelation: "schedule_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_template_origin_id_fkey"
            columns: ["template_origin_id"]
            isOneToOne: false
            referencedRelation: "schedule_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_swap_requests: {
        Row: {
          accepted_at: string | null
          approved_at: string | null
          created_at: string
          decided_at: string | null
          decision_note: string | null
          facility_id: string
          id: string
          manager_approver_employee_id: string | null
          requester_employee_id: string
          requester_shift_id: string
          status: string
          target_employee_id: string | null
          target_shift_id: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          approved_at?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          facility_id: string
          id?: string
          manager_approver_employee_id?: string | null
          requester_employee_id: string
          requester_shift_id: string
          status?: string
          target_employee_id?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          approved_at?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          facility_id?: string
          id?: string
          manager_approver_employee_id?: string | null
          requester_employee_id?: string
          requester_shift_id?: string
          status?: string
          target_employee_id?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_swap_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_swap_requests_manager_approver_employee_id_fkey"
            columns: ["manager_approver_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_swap_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_swap_requests_requester_shift_id_fkey"
            columns: ["requester_shift_id"]
            isOneToOne: false
            referencedRelation: "schedule_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_swap_requests_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_swap_requests_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "schedule_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_template_shifts: {
        Row: {
          break_minutes: number | null
          created_at: string
          day_of_week: number
          department_id: string
          end_time: string
          facility_id: string
          id: string
          role_label: string | null
          staff_count: number
          start_time: string
          template_id: string
          updated_at: string | null
        }
        Insert: {
          break_minutes?: number | null
          created_at?: string
          day_of_week: number
          department_id: string
          end_time: string
          facility_id: string
          id?: string
          role_label?: string | null
          staff_count?: number
          start_time: string
          template_id: string
          updated_at?: string | null
        }
        Update: {
          break_minutes?: number | null
          created_at?: string
          day_of_week?: number
          department_id?: string
          end_time?: string
          facility_id?: string
          id?: string
          role_label?: string | null
          staff_count?: number
          start_time?: string
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_template_shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_template_shifts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_template_shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "schedule_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_templates: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_time_off_requests: {
        Row: {
          approved_by_employee_id: string | null
          created_at: string
          decided_at: string | null
          decision_note: string | null
          employee_id: string
          ends_at: string
          facility_id: string
          id: string
          reason: string | null
          starts_at: string
          status: string
          updated_at: string | null
        }
        Insert: {
          approved_by_employee_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          employee_id: string
          ends_at: string
          facility_id: string
          id?: string
          reason?: string | null
          starts_at: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          approved_by_employee_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          employee_id?: string
          ends_at?: string
          facility_id?: string
          id?: string
          reason?: string | null
          starts_at?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_time_off_requests_approved_by_employee_id_fkey"
            columns: ["approved_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_time_off_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          facility_id: string | null
          full_name: string | null
          id: string
          is_active: boolean
          is_super_admin: boolean
          last_seen_at: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          facility_id?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          is_super_admin?: boolean
          last_seen_at?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          facility_id?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_super_admin?: boolean
          last_seen_at?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_employee_id: { Args: never; Returns: string }
      current_facility_id: { Args: never; Returns: string }
      current_user_id: { Args: never; Returns: string }
      current_user_record: {
        Args: never
        Returns: {
          created_at: string
          email: string
          facility_id: string | null
          full_name: string | null
          id: string
          is_active: boolean
          is_super_admin: boolean
          last_seen_at: string | null
          phone: string | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_role: { Args: never; Returns: string }
      get_employee_counts_by_facility: {
        Args: never
        Returns: {
          employee_count: number
          facility_id: string
        }[]
      }
      has_area_access: {
        Args: { p_area_id: string; p_module_key: string }
        Returns: boolean
      }
      has_module_access: { Args: { p_module_key: string }; Returns: boolean }
      has_module_admin_access: {
        Args: { p_module_key: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      purge_old_accident_reports: { Args: never; Returns: number }
      purge_old_air_quality_reports: { Args: never; Returns: number }
      purge_old_audit_logs: { Args: never; Returns: number }
      purge_old_communications: { Args: never; Returns: number }
      purge_old_daily_reports: { Args: never; Returns: number }
      purge_old_ice_operations_submissions: { Args: never; Returns: number }
      purge_old_incident_reports: { Args: never; Returns: number }
      purge_old_refrigeration_reports: { Args: never; Returns: number }
      scheduling_claim_open_shift: {
        Args: { p_open_shift_id: string }
        Returns: boolean
      }
      seed_default_accident_dropdowns: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_air_quality_config: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_ice_depth_settings: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_ice_operations_config: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_incident_types_and_severities: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_refrigeration_sections: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_roles_for_facility: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_scheduling_config: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

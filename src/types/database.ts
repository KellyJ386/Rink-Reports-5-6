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
      purge_old_daily_reports: { Args: never; Returns: number }
      seed_default_incident_types_and_severities: {
        Args: { p_facility_id: string }
        Returns: undefined
      }
      seed_default_roles_for_facility: {
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

// ---------------------------------------------------------------------------
// Project shorthand aliases (not part of the generated output).
// ---------------------------------------------------------------------------

export type Inserts<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type Updates<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]

export type Functions<T extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][T]

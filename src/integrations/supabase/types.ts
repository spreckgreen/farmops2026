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
      activity_log: {
        Row: {
          ai_summary: string | null
          created_at: string
          daily_note_id: string | null
          entry_type: Database["public"]["Enums"]["entry_type"]
          id: string
          raw_content: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          daily_note_id?: string | null
          entry_type?: Database["public"]["Enums"]["entry_type"]
          id?: string
          raw_content: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          daily_note_id?: string | null
          entry_type?: Database["public"]["Enums"]["entry_type"]
          id?: string
          raw_content?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_daily_note_id_fkey"
            columns: ["daily_note_id"]
            isOneToOne: false
            referencedRelation: "daily_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      consumables: {
        Row: {
          category: string | null
          cost_per_unit: number | null
          created_at: string
          id: string
          min_quantity: number
          name: string
          quantity_in_stock: number
          raw: Json
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          id?: string
          min_quantity?: number
          name: string
          quantity_in_stock?: number
          raw?: Json
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          id?: string
          min_quantity?: number
          name?: string
          quantity_in_stock?: number
          raw?: Json
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crop_harvests: {
        Row: {
          created_at: string
          harvested_on: string
          id: string
          notes: string | null
          planting_id: string | null
          quality: string | null
          quantity: number
          raw: Json
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          harvested_on?: string
          id?: string
          notes?: string | null
          planting_id?: string | null
          quality?: string | null
          quantity?: number
          raw?: Json
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          harvested_on?: string
          id?: string
          notes?: string | null
          planting_id?: string | null
          quality?: string | null
          quantity?: number
          raw?: Json
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crop_harvests_planting_id_fkey"
            columns: ["planting_id"]
            isOneToOne: false
            referencedRelation: "crop_plantings"
            referencedColumns: ["id"]
          },
        ]
      }
      crop_plantings: {
        Row: {
          area: string | null
          created_at: string
          crop: string
          expected_harvest: string | null
          id: string
          notes: string | null
          planted_on: string | null
          raw: Json
          status: string
          updated_at: string
          user_id: string
          variety: string | null
        }
        Insert: {
          area?: string | null
          created_at?: string
          crop: string
          expected_harvest?: string | null
          id?: string
          notes?: string | null
          planted_on?: string | null
          raw?: Json
          status?: string
          updated_at?: string
          user_id: string
          variety?: string | null
        }
        Update: {
          area?: string | null
          created_at?: string
          crop?: string
          expected_harvest?: string | null
          id?: string
          notes?: string | null
          planted_on?: string | null
          raw?: Json
          status?: string
          updated_at?: string
          user_id?: string
          variety?: string | null
        }
        Relationships: []
      }
      daily_notes: {
        Row: {
          created_at: string
          date: string
          id: string
          markdown_content: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          markdown_content?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          markdown_content?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_plan_entries: {
        Row: {
          created_at: string
          day_of_week: number
          food_id: string
          id: string
          person_id: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          food_id: string
          id?: string
          person_id: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          food_id?: string
          id?: string
          person_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_plan_entries_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "food_plan_foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_plan_entries_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "food_plan_people"
            referencedColumns: ["id"]
          },
        ]
      }
      food_plan_foods: {
        Row: {
          category: string
          created_at: string
          freeze_dry: boolean
          id: string
          meal: string | null
          name: string
          oz_per_serving: number | null
          price_per_pound: number | null
          season: string | null
          sort_order: number
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          freeze_dry?: boolean
          id?: string
          meal?: string | null
          name: string
          oz_per_serving?: number | null
          price_per_pound?: number | null
          season?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          freeze_dry?: boolean
          id?: string
          meal?: string | null
          name?: string
          oz_per_serving?: number | null
          price_per_pound?: number | null
          season?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_plan_people: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_price_history: {
        Row: {
          changed_at: string
          food_id: string | null
          food_name: string
          id: string
          new_price: number | null
          old_price: number | null
          user_id: string
        }
        Insert: {
          changed_at?: string
          food_id?: string | null
          food_name: string
          id?: string
          new_price?: number | null
          old_price?: number | null
          user_id: string
        }
        Update: {
          changed_at?: string
          food_id?: string | null
          food_name?: string
          id?: string
          new_price?: number | null
          old_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_price_history_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "food_plan_foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_storage_items: {
        Row: {
          acquired_on: string | null
          best_by: string | null
          category: string | null
          created_at: string
          description: string | null
          food_type: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          price: number | null
          quantity: number
          source_url: string | null
          status: string
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acquired_on?: string | null
          best_by?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          food_type?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          price?: number | null
          quantity?: number
          source_url?: string | null
          status?: string
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acquired_on?: string | null
          best_by?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          food_type?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          price?: number | null
          quantity?: number
          source_url?: string | null
          status?: string
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_storage_plan: {
        Row: {
          category: string | null
          created_at: string
          food_type: string | null
          id: string
          name: string
          notes: string | null
          pounds_per_year: number
          price_per_pound: number | null
          sort_order: number
          target_months: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          food_type?: string | null
          id?: string
          name: string
          notes?: string | null
          pounds_per_year?: number
          price_per_pound?: number | null
          sort_order?: number
          target_months?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          food_type?: string | null
          id?: string
          name?: string
          notes?: string | null
          pounds_per_year?: number
          price_per_pound?: number | null
          sort_order?: number
          target_months?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      garden_plots: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          plant_name: string | null
          position: number
          row_label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          plant_name?: string | null
          position: number
          row_label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          plant_name?: string | null
          position?: number
          row_label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string
          current_hours: number
          current_miles: number
          description: string | null
          id: string
          item_type: string | null
          location: string | null
          min_quantity: number | null
          name: string | null
          notes: string | null
          quantity: number | null
          raw: Json
          reorder_level: number | null
          sku: string | null
          status: string
          tags: string[]
          unit: string | null
          unit_cost: number | null
          updated_at: string
          usage_tracking: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          current_hours?: number
          current_miles?: number
          description?: string | null
          id?: string
          item_type?: string | null
          location?: string | null
          min_quantity?: number | null
          name?: string | null
          notes?: string | null
          quantity?: number | null
          raw?: Json
          reorder_level?: number | null
          sku?: string | null
          status?: string
          tags?: string[]
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
          usage_tracking?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          current_hours?: number
          current_miles?: number
          description?: string | null
          id?: string
          item_type?: string | null
          location?: string | null
          min_quantity?: number | null
          name?: string | null
          notes?: string | null
          quantity?: number | null
          raw?: Json
          reorder_level?: number | null
          sku?: string | null
          status?: string
          tags?: string[]
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
          usage_tracking?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: []
      }
      livestock_animals: {
        Row: {
          birth_date: string | null
          breed: string | null
          created_at: string
          expected_yield_lbs: number | null
          id: string
          location: string | null
          notes: string | null
          purpose: string
          quantity: number
          sex: string | null
          species: string
          status: string
          tag: string | null
          updated_at: string
          user_id: string
          yield_unit: string
        }
        Insert: {
          birth_date?: string | null
          breed?: string | null
          created_at?: string
          expected_yield_lbs?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          purpose?: string
          quantity?: number
          sex?: string | null
          species: string
          status?: string
          tag?: string | null
          updated_at?: string
          user_id: string
          yield_unit?: string
        }
        Update: {
          birth_date?: string | null
          breed?: string | null
          created_at?: string
          expected_yield_lbs?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          purpose?: string
          quantity?: number
          sex?: string | null
          species?: string
          status?: string
          tag?: string | null
          updated_at?: string
          user_id?: string
          yield_unit?: string
        }
        Relationships: []
      }
      maintenance_records: {
        Row: {
          asset_id: string | null
          asset_name: string | null
          completed_date: string | null
          consumables_used: Json
          cost: number | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          notes: string | null
          performed_at: string | null
          raw: Json
          recurrence: string | null
          scheduled_date: string | null
          service_type: string | null
          status: string | null
          title: string | null
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          asset_id?: string | null
          asset_name?: string | null
          completed_date?: string | null
          consumables_used?: Json
          cost?: number | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          performed_at?: string | null
          raw?: Json
          recurrence?: string | null
          scheduled_date?: string | null
          service_type?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          asset_id?: string | null
          asset_name?: string | null
          completed_date?: string | null
          consumables_used?: Json
          cost?: number | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          performed_at?: string | null
          raw?: Json
          recurrence?: string | null
          scheduled_date?: string | null
          service_type?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      orchard_trees: {
        Row: {
          category: string | null
          created_at: string
          id: string
          location: string | null
          notes: string | null
          planted_on: string | null
          quantity: number
          species: string
          status: string
          updated_at: string
          user_id: string
          variety: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          planted_on?: string | null
          quantity?: number
          species: string
          status?: string
          updated_at?: string
          user_id: string
          variety?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          planted_on?: string | null
          quantity?: number
          species?: string
          status?: string
          updated_at?: string
          user_id?: string
          variety?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      summaries: {
        Row: {
          created_at: string
          display_title: string | null
          edited_summary: Json | null
          generated_summary: Json
          id: string
          mode: Database["public"]["Enums"]["summary_mode"]
          period_end: string
          period_start: string
          scope_project: string | null
          scope_task_id: string | null
          status: Database["public"]["Enums"]["summary_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_title?: string | null
          edited_summary?: Json | null
          generated_summary: Json
          id?: string
          mode: Database["public"]["Enums"]["summary_mode"]
          period_end: string
          period_start: string
          scope_project?: string | null
          scope_task_id?: string | null
          status?: Database["public"]["Enums"]["summary_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_title?: string | null
          edited_summary?: Json | null
          generated_summary?: Json
          id?: string
          mode?: Database["public"]["Enums"]["summary_mode"]
          period_end?: string
          period_start?: string
          scope_project?: string | null
          scope_task_id?: string | null
          status?: Database["public"]["Enums"]["summary_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "summaries_scope_task_id_fkey"
            columns: ["scope_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          percent_complete: number
          project_tags: string[]
          recurrence: string
          recurrence_next_at: string | null
          slug: string
          start_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          percent_complete?: number
          project_tags?: string[]
          recurrence?: string
          recurrence_next_at?: string | null
          slug: string
          start_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          percent_complete?: number
          project_tags?: string[]
          recurrence?: string
          recurrence_next_at?: string | null
          slug?: string
          start_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "viewer" | "editor" | "admin"
      approval_status: "pending" | "approved" | "rejected"
      entry_type:
        | "status"
        | "blocker"
        | "decision"
        | "commit"
        | "meeting"
        | "note"
      summary_mode:
        | "task_update"
        | "project_rollup"
        | "weekly_report"
        | "quarter_review"
        | "daily_recap"
        | "monthly_rollup"
        | "yearly_rollup"
      summary_status: "draft" | "reviewed" | "published"
      task_status: "open" | "blocked" | "done"
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
    Enums: {
      app_role: ["viewer", "editor", "admin"],
      approval_status: ["pending", "approved", "rejected"],
      entry_type: [
        "status",
        "blocker",
        "decision",
        "commit",
        "meeting",
        "note",
      ],
      summary_mode: [
        "task_update",
        "project_rollup",
        "weekly_report",
        "quarter_review",
        "daily_recap",
        "monthly_rollup",
        "yearly_rollup",
      ],
      summary_status: ["draft", "reviewed", "published"],
      task_status: ["open", "blocked", "done"],
    },
  },
} as const

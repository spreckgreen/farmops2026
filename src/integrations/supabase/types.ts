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
      ai_action_log: {
        Row: {
          applied_at: string | null
          created_at: string
          id: string
          plan: Json
          result: Json | null
          status: string
          surface: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          id?: string
          plan: Json
          result?: Json | null
          status?: string
          surface: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          id?: string
          plan?: Json
          result?: Json | null
          status?: string
          surface?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_job_idempotency: {
        Row: {
          created_at: string
          error: string | null
          id: string
          request_hash: string
          result: Json | null
          status: string
          surface: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          request_hash: string
          result?: Json | null
          status: string
          surface: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          request_hash?: string
          result?: Json | null
          status?: string
          surface?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      asset_usage_snapshots: {
        Row: {
          created_at: string
          hours: number | null
          id: string
          inventory_item_id: string
          miles: number | null
          recorded_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hours?: number | null
          id?: string
          inventory_item_id: string
          miles?: number | null
          recorded_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hours?: number | null
          id?: string
          inventory_item_id?: string
          miles?: number | null
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_usage_snapshots_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
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
          energy_level: number | null
          id: string
          markdown_content: string
          productivity_level: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          energy_level?: number | null
          id?: string
          markdown_content?: string
          productivity_level?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          energy_level?: number | null
          id?: string
          markdown_content?: string
          productivity_level?: number | null
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
      plant_seasons: {
        Row: {
          created_at: string
          id: string
          kind: string
          lead: string
          name: string
          notes: string
          season: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          lead?: string
          name: string
          notes?: string
          season?: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          lead?: string
          name?: string
          notes?: string
          season?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      procedure_links: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string | null
          maintenance_record_id: string | null
          notes: string | null
          procedure_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          maintenance_record_id?: string | null
          notes?: string | null
          procedure_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          maintenance_record_id?: string | null
          notes?: string | null
          procedure_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_links_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_links_maintenance_record_id_fkey"
            columns: ["maintenance_record_id"]
            isOneToOne: false
            referencedRelation: "maintenance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_links_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
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
      project_design_elements: {
        Row: {
          completed: boolean
          created_at: string
          description: string | null
          id: string
          project_id: string
          sort_order: number
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          completed?: boolean
          created_at?: string
          description?: string | null
          id?: string
          project_id: string
          sort_order?: number
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          weight?: number
        }
        Update: {
          completed?: boolean
          created_at?: string
          description?: string | null
          id?: string
          project_id?: string
          sort_order?: number
          task_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_design_elements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_design_elements_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
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
      rachio_controllers: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string | null
          model: string | null
          name: string | null
          rachio_id: string
          raw: Json | null
          serial_number: string | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          model?: string | null
          name?: string | null
          rachio_id: string
          raw?: Json | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          model?: string | null
          name?: string | null
          rachio_id?: string
          raw?: Json | null
          serial_number?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rachio_runs: {
        Row: {
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          gallons: number | null
          id: string
          rachio_event_id: string | null
          raw: Json | null
          source: string | null
          started_at: string
          status: string | null
          updated_at: string
          user_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          gallons?: number | null
          id?: string
          rachio_event_id?: string | null
          raw?: Json | null
          source?: string | null
          started_at: string
          status?: string | null
          updated_at?: string
          user_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          gallons?: number | null
          id?: string
          rachio_event_id?: string | null
          raw?: Json | null
          source?: string | null
          started_at?: string
          status?: string | null
          updated_at?: string
          user_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rachio_runs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "rachio_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      rachio_webhook_events: {
        Row: {
          error: string | null
          event_type: string | null
          external_id: string | null
          id: string
          payload: Json | null
          processed_at: string | null
          received_at: string
          signature_ok: boolean
        }
        Insert: {
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          signature_ok: boolean
        }
        Update: {
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          signature_ok?: boolean
        }
        Relationships: []
      }
      rachio_zones: {
        Row: {
          area_sqft: number | null
          controller_id: string
          created_at: string
          enabled: boolean | null
          garden_plot_id: string | null
          id: string
          last_run_at: string | null
          name: string | null
          next_run_at: string | null
          nozzle: string | null
          orchard_tree_id: string | null
          rachio_id: string
          raw: Json | null
          updated_at: string
          user_id: string
          zone_number: number | null
        }
        Insert: {
          area_sqft?: number | null
          controller_id: string
          created_at?: string
          enabled?: boolean | null
          garden_plot_id?: string | null
          id?: string
          last_run_at?: string | null
          name?: string | null
          next_run_at?: string | null
          nozzle?: string | null
          orchard_tree_id?: string | null
          rachio_id: string
          raw?: Json | null
          updated_at?: string
          user_id: string
          zone_number?: number | null
        }
        Update: {
          area_sqft?: number | null
          controller_id?: string
          created_at?: string
          enabled?: boolean | null
          garden_plot_id?: string | null
          id?: string
          last_run_at?: string | null
          name?: string | null
          next_run_at?: string | null
          nozzle?: string | null
          orchard_tree_id?: string | null
          rachio_id?: string
          raw?: Json | null
          updated_at?: string
          user_id?: string
          zone_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rachio_zones_controller_id_fkey"
            columns: ["controller_id"]
            isOneToOne: false
            referencedRelation: "rachio_controllers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rachio_zones_garden_plot_id_fkey"
            columns: ["garden_plot_id"]
            isOneToOne: false
            referencedRelation: "garden_plots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rachio_zones_orchard_tree_id_fkey"
            columns: ["orchard_tree_id"]
            isOneToOne: false
            referencedRelation: "orchard_trees"
            referencedColumns: ["id"]
          },
        ]
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
          design_element_id: string | null
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
          design_element_id?: string | null
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
          design_element_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "tasks_design_element_id_fkey"
            columns: ["design_element_id"]
            isOneToOne: false
            referencedRelation: "project_design_elements"
            referencedColumns: ["id"]
          },
        ]
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
      vault_key_export_audit: {
        Row: {
          action: string
          created_at: string
          credential_id: string | null
          detail: string | null
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          credential_id?: string | null
          detail?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          credential_id?: string | null
          detail?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vault_key_wrap_credentials: {
        Row: {
          created_at: string
          credential_id: string
          id: string
          label: string
          last_used_at: string | null
          public_key: string
          salt: string
          sign_count: number
          transports: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          id?: string
          label: string
          last_used_at?: string | null
          public_key: string
          salt: string
          sign_count?: number
          transports?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          id?: string
          label?: string
          last_used_at?: string | null
          public_key?: string
          salt?: string
          sign_count?: number
          transports?: string[]
          user_id?: string
        }
        Relationships: []
      }
      vault_secrets: {
        Row: {
          created_at: string
          created_by: string
          env_key: string | null
          id: string
          key_version: number
          notes_ciphertext: string | null
          notes_iv: string | null
          notes_tag: string | null
          owner_user_id: string | null
          scope: string
          title: string
          updated_at: string
          value_ciphertext: string
          value_iv: string
          value_tag: string
        }
        Insert: {
          created_at?: string
          created_by: string
          env_key?: string | null
          id?: string
          key_version?: number
          notes_ciphertext?: string | null
          notes_iv?: string | null
          notes_tag?: string | null
          owner_user_id?: string | null
          scope: string
          title: string
          updated_at?: string
          value_ciphertext: string
          value_iv: string
          value_tag: string
        }
        Update: {
          created_at?: string
          created_by?: string
          env_key?: string | null
          id?: string
          key_version?: number
          notes_ciphertext?: string | null
          notes_iv?: string | null
          notes_tag?: string | null
          owner_user_id?: string | null
          scope?: string
          title?: string
          updated_at?: string
          value_ciphertext?: string
          value_iv?: string
          value_tag?: string
        }
        Relationships: []
      }
      weather_forecasts: {
        Row: {
          conditions: string | null
          created_at: string
          feels_like_high_f: number | null
          feels_like_low_f: number | null
          fetched_at: string
          forecast_date: string
          high_temp_f: number | null
          humidity: number | null
          icon: string | null
          id: string
          low_temp_f: number | null
          precip_probability: number | null
          precip_type: string | null
          raw: Json | null
          station_id: string
          sunrise: string | null
          sunset: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conditions?: string | null
          created_at?: string
          feels_like_high_f?: number | null
          feels_like_low_f?: number | null
          fetched_at?: string
          forecast_date: string
          high_temp_f?: number | null
          humidity?: number | null
          icon?: string | null
          id?: string
          low_temp_f?: number | null
          precip_probability?: number | null
          precip_type?: string | null
          raw?: Json | null
          station_id: string
          sunrise?: string | null
          sunset?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conditions?: string | null
          created_at?: string
          feels_like_high_f?: number | null
          feels_like_low_f?: number | null
          fetched_at?: string
          forecast_date?: string
          high_temp_f?: number | null
          humidity?: number | null
          icon?: string | null
          id?: string
          low_temp_f?: number | null
          precip_probability?: number | null
          precip_type?: string | null
          raw?: Json | null
          station_id?: string
          sunrise?: string | null
          sunset?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webauthn_challenges: {
        Row: {
          challenge: string
          created_at: string
          expires_at: string
          id: string
          purpose: string
          user_id: string
        }
        Insert: {
          challenge: string
          created_at?: string
          expires_at: string
          id?: string
          purpose: string
          user_id: string
        }
        Update: {
          challenge?: string
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      restore_table_diagnostics: { Args: { _table: string }; Returns: Json }
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

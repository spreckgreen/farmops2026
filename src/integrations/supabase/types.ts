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
      ai_feature_toggles: {
        Row: {
          area: string
          created_at: string
          enabled: boolean
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          area: string
          created_at?: string
          enabled?: boolean
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          area?: string
          created_at?: string
          enabled?: boolean
          note?: string | null
          updated_at?: string
          updated_by?: string | null
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
      ai_usage_events: {
        Row: {
          area: string
          area_label: string | null
          backend: string
          cost_usd: number
          created_at: string
          engine_id: string | null
          estimated: boolean
          id: string
          input_tokens: number
          latency_ms: number | null
          metered: boolean
          model: string | null
          note: string | null
          output_tokens: number
          user_id: string
        }
        Insert: {
          area: string
          area_label?: string | null
          backend: string
          cost_usd?: number
          created_at?: string
          engine_id?: string | null
          estimated?: boolean
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          metered?: boolean
          model?: string | null
          note?: string | null
          output_tokens?: number
          user_id: string
        }
        Update: {
          area?: string
          area_label?: string | null
          backend?: string
          cost_usd?: number
          created_at?: string
          engine_id?: string | null
          estimated?: boolean
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          metered?: boolean
          model?: string | null
          note?: string | null
          output_tokens?: number
          user_id?: string
        }
        Relationships: []
      }
      app_addons: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_entitlements: {
        Row: {
          addon_key: string
          blocked_until: string | null
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          notes: string | null
          revoked_count: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          addon_key: string
          blocked_until?: string | null
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          notes?: string | null
          revoked_count?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          addon_key?: string
          blocked_until?: string | null
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          notes?: string | null
          revoked_count?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_entitlements_addon_key_fkey"
            columns: ["addon_key"]
            isOneToOne: false
            referencedRelation: "app_addons"
            referencedColumns: ["key"]
          },
        ]
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
      electrical_ai_feature_grants: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          request_note: string | null
          requested_at: string
          scenario: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          request_note?: string | null
          requested_at?: string
          scenario: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          request_note?: string | null
          requested_at?: string
          scenario?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_api_principals: {
        Row: {
          created_at: string
          disabled_at: string | null
          expires_at: string | null
          id: string
          key_prefix: string
          key_sha256: string
          last_used_at: string | null
          name: string
          note: string | null
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          expires_at?: string | null
          id?: string
          key_prefix: string
          key_sha256: string
          last_used_at?: string | null
          name: string
          note?: string | null
          scopes?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          expires_at?: string | null
          id?: string
          key_prefix?: string
          key_sha256?: string
          last_used_at?: string | null
          name?: string
          note?: string | null
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_audit_batch_items: {
        Row: {
          applied_at: string | null
          applied_row_uuid: string | null
          approved: boolean
          batch_uuid: string
          created_at: string
          disposition: string
          entity_kind: string
          expected_updated_at: string | null
          id: string
          item_key: string
          observation_class: string
          operation: string
          payload: Json
          preview_after: Json | null
          preview_before: Json | null
          target_stable_id: string | null
          updated_at: string
          validation_messages: Json
        }
        Insert: {
          applied_at?: string | null
          applied_row_uuid?: string | null
          approved?: boolean
          batch_uuid: string
          created_at?: string
          disposition?: string
          entity_kind: string
          expected_updated_at?: string | null
          id?: string
          item_key: string
          observation_class: string
          operation: string
          payload?: Json
          preview_after?: Json | null
          preview_before?: Json | null
          target_stable_id?: string | null
          updated_at?: string
          validation_messages?: Json
        }
        Update: {
          applied_at?: string | null
          applied_row_uuid?: string | null
          approved?: boolean
          batch_uuid?: string
          created_at?: string
          disposition?: string
          entity_kind?: string
          expected_updated_at?: string | null
          id?: string
          item_key?: string
          observation_class?: string
          operation?: string
          payload?: Json
          preview_after?: Json | null
          preview_before?: Json | null
          target_stable_id?: string | null
          updated_at?: string
          validation_messages?: Json
        }
        Relationships: [
          {
            foreignKeyName: "electrical_audit_batch_items_batch_uuid_fkey"
            columns: ["batch_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_audit_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_audit_batches: {
        Row: {
          applied_at: string | null
          approval_reason: string | null
          approval_statement: string | null
          approved_at: string | null
          approved_by: string | null
          batch_id: string
          building: string | null
          compensates_batch_id: string | null
          created_at: string
          created_by: string
          evidence: Json
          id: string
          manifest: Json
          manifest_sha256: string
          observed_date: string | null
          observed_time_precision: string | null
          schema_version: string
          scope: string | null
          source: string | null
          status: string
          summary: Json
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          approval_reason?: string | null
          approval_statement?: string | null
          approved_at?: string | null
          approved_by?: string | null
          batch_id: string
          building?: string | null
          compensates_batch_id?: string | null
          created_at?: string
          created_by: string
          evidence?: Json
          id?: string
          manifest?: Json
          manifest_sha256: string
          observed_date?: string | null
          observed_time_precision?: string | null
          schema_version?: string
          scope?: string | null
          source?: string | null
          status?: string
          summary?: Json
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          approval_reason?: string | null
          approval_statement?: string | null
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string
          building?: string | null
          compensates_batch_id?: string | null
          created_at?: string
          created_by?: string
          evidence?: Json
          id?: string
          manifest?: Json
          manifest_sha256?: string
          observed_date?: string | null
          observed_time_precision?: string | null
          schema_version?: string
          scope?: string | null
          source?: string | null
          status?: string
          summary?: Json
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      electrical_branch_runs: {
        Row: {
          branch_id: string
          cable_type: string | null
          circuit_group_uuid: string | null
          circuit_rating_amps: number | null
          completion_percent: number
          conductor_count: number | null
          conductor_size: string | null
          created_at: string
          dest_endpoint_ref: string | null
          dest_endpoint_type: string | null
          device_side_connected: boolean
          ground_conductor: string | null
          id: string
          install_status: string
          label_status: string
          load_uuid: string | null
          measured_length_ft: number | null
          notes: string | null
          ods_extras: string | null
          path_notes: string | null
          planned_length_ft: number | null
          source_endpoint_ref: string | null
          source_endpoint_type: string | null
          source_jbox_uuid: string | null
          source_panel_uuid: string | null
          source_side_connected: boolean
          updated_at: string
          user_id: string
          voltage: number | null
          wiring_method: string | null
        }
        Insert: {
          branch_id: string
          cable_type?: string | null
          circuit_group_uuid?: string | null
          circuit_rating_amps?: number | null
          completion_percent?: number
          conductor_count?: number | null
          conductor_size?: string | null
          created_at?: string
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          device_side_connected?: boolean
          ground_conductor?: string | null
          id?: string
          install_status?: string
          label_status?: string
          load_uuid?: string | null
          measured_length_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          path_notes?: string | null
          planned_length_ft?: number | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_jbox_uuid?: string | null
          source_panel_uuid?: string | null
          source_side_connected?: boolean
          updated_at?: string
          user_id: string
          voltage?: number | null
          wiring_method?: string | null
        }
        Update: {
          branch_id?: string
          cable_type?: string | null
          circuit_group_uuid?: string | null
          circuit_rating_amps?: number | null
          completion_percent?: number
          conductor_count?: number | null
          conductor_size?: string | null
          created_at?: string
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          device_side_connected?: boolean
          ground_conductor?: string | null
          id?: string
          install_status?: string
          label_status?: string
          load_uuid?: string | null
          measured_length_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          path_notes?: string | null
          planned_length_ft?: number | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_jbox_uuid?: string | null
          source_panel_uuid?: string | null
          source_side_connected?: boolean
          updated_at?: string
          user_id?: string
          voltage?: number | null
          wiring_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_branch_runs_circuit_group_uuid_fkey"
            columns: ["circuit_group_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_circuit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_branch_runs_load_uuid_fkey"
            columns: ["load_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_branch_runs_source_jbox_uuid_fkey"
            columns: ["source_jbox_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_junction_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_branch_runs_source_panel_uuid_fkey"
            columns: ["source_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_breaker_positions: {
        Row: {
          breaker_number: number | null
          circuit_group_uuid: string | null
          completion_percent: number | null
          created_at: string
          id: string
          install_status: string | null
          label: string | null
          label_status: string | null
          load_uuid: string | null
          notes: string | null
          ocp_amps: number | null
          panel_uuid: string
          poles: number
          position: number
          side: string
          updated_at: string
          user_id: string
        }
        Insert: {
          breaker_number?: number | null
          circuit_group_uuid?: string | null
          completion_percent?: number | null
          created_at?: string
          id?: string
          install_status?: string | null
          label?: string | null
          label_status?: string | null
          load_uuid?: string | null
          notes?: string | null
          ocp_amps?: number | null
          panel_uuid: string
          poles?: number
          position: number
          side?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          breaker_number?: number | null
          circuit_group_uuid?: string | null
          completion_percent?: number | null
          created_at?: string
          id?: string
          install_status?: string | null
          label?: string | null
          label_status?: string | null
          load_uuid?: string | null
          notes?: string | null
          ocp_amps?: number | null
          panel_uuid?: string
          poles?: number
          position?: number
          side?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_breaker_positions_circuit_group_uuid_fkey"
            columns: ["circuit_group_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_circuit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_breaker_positions_load_uuid_fkey"
            columns: ["load_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_breaker_positions_panel_uuid_fkey"
            columns: ["panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_change_audit: {
        Row: {
          access_basis: string | null
          action: string
          actor_email: string | null
          changes: Json
          created_at: string
          entity_kind: string
          entity_ref: string | null
          entity_uuid: string | null
          id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          section: string
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_basis?: string | null
          action: string
          actor_email?: string | null
          changes?: Json
          created_at?: string
          entity_kind: string
          entity_ref?: string | null
          entity_uuid?: string | null
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section: string
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_basis?: string | null
          action?: string
          actor_email?: string | null
          changes?: Json
          created_at?: string
          entity_kind?: string
          entity_ref?: string | null
          entity_uuid?: string | null
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_circuit_groups: {
        Row: {
          backup_eligible: boolean | null
          backup_panel: string | null
          backup_priority: string | null
          breaker_number: number | null
          breaker_position: string | null
          circuit_group_id: string
          circuit_rating_amps: number | null
          completion_percent: number
          continuous_load: boolean | null
          created_at: string
          critical: boolean | null
          demand_basis: string | null
          demand_va: number | null
          description: string | null
          generator_start_amps: number | null
          generator_start_class: string | null
          id: string
          install_status: string
          label_status: string
          load_shed_group: string | null
          notes: string | null
          ods_extras: string | null
          panel_uuid: string | null
          phase: string | null
          suggested_panel: string | null
          updated_at: string
          user_id: string
          voltage: number | null
        }
        Insert: {
          backup_eligible?: boolean | null
          backup_panel?: string | null
          backup_priority?: string | null
          breaker_number?: number | null
          breaker_position?: string | null
          circuit_group_id: string
          circuit_rating_amps?: number | null
          completion_percent?: number
          continuous_load?: boolean | null
          created_at?: string
          critical?: boolean | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          generator_start_amps?: number | null
          generator_start_class?: string | null
          id?: string
          install_status?: string
          label_status?: string
          load_shed_group?: string | null
          notes?: string | null
          ods_extras?: string | null
          panel_uuid?: string | null
          phase?: string | null
          suggested_panel?: string | null
          updated_at?: string
          user_id: string
          voltage?: number | null
        }
        Update: {
          backup_eligible?: boolean | null
          backup_panel?: string | null
          backup_priority?: string | null
          breaker_number?: number | null
          breaker_position?: string | null
          circuit_group_id?: string
          circuit_rating_amps?: number | null
          completion_percent?: number
          continuous_load?: boolean | null
          created_at?: string
          critical?: boolean | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          generator_start_amps?: number | null
          generator_start_class?: string | null
          id?: string
          install_status?: string
          label_status?: string
          load_shed_group?: string | null
          notes?: string | null
          ods_extras?: string | null
          panel_uuid?: string | null
          phase?: string | null
          suggested_panel?: string | null
          updated_at?: string
          user_id?: string
          voltage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_circuit_groups_panel_uuid_fkey"
            columns: ["panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_devices: {
        Row: {
          address: string | null
          asset_ref: string | null
          asset_uuid: string | null
          building: string | null
          circuit_group_ref: string | null
          circuit_group_uuid: string | null
          completion_percent: number | null
          created_at: string
          description: string | null
          device_id: string
          device_role: string | null
          device_type: string | null
          grid: string | null
          hostname: string | null
          id: string
          input_current_amps: number | null
          input_voltage: number | null
          install_status: string
          label_status: string
          load_ref: string | null
          load_uuid: string | null
          location_note: string | null
          manufacturer: string | null
          model: string | null
          notes: string | null
          power_asset_ref: string | null
          power_asset_uuid: string | null
          rack_position_u: number | null
          rack_ref: string | null
          rack_uuid: string | null
          updated_at: string
          uplink_device_ref: string | null
          uplink_device_uuid: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          asset_ref?: string | null
          asset_uuid?: string | null
          building?: string | null
          circuit_group_ref?: string | null
          circuit_group_uuid?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          device_id: string
          device_role?: string | null
          device_type?: string | null
          grid?: string | null
          hostname?: string | null
          id?: string
          input_current_amps?: number | null
          input_voltage?: number | null
          install_status?: string
          label_status?: string
          load_ref?: string | null
          load_uuid?: string | null
          location_note?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          power_asset_ref?: string | null
          power_asset_uuid?: string | null
          rack_position_u?: number | null
          rack_ref?: string | null
          rack_uuid?: string | null
          updated_at?: string
          uplink_device_ref?: string | null
          uplink_device_uuid?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          asset_ref?: string | null
          asset_uuid?: string | null
          building?: string | null
          circuit_group_ref?: string | null
          circuit_group_uuid?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          device_id?: string
          device_role?: string | null
          device_type?: string | null
          grid?: string | null
          hostname?: string | null
          id?: string
          input_current_amps?: number | null
          input_voltage?: number | null
          install_status?: string
          label_status?: string
          load_ref?: string | null
          load_uuid?: string | null
          location_note?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          power_asset_ref?: string | null
          power_asset_uuid?: string | null
          rack_position_u?: number | null
          rack_ref?: string | null
          rack_uuid?: string | null
          updated_at?: string
          uplink_device_ref?: string | null
          uplink_device_uuid?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_devices_asset_uuid_fkey"
            columns: ["asset_uuid"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_devices_circuit_group_uuid_fkey"
            columns: ["circuit_group_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_circuit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_devices_load_uuid_fkey"
            columns: ["load_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_devices_power_asset_uuid_fkey"
            columns: ["power_asset_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_power_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_devices_rack_uuid_fkey"
            columns: ["rack_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_racks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_devices_uplink_device_uuid_fkey"
            columns: ["uplink_device_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_feeders: {
        Row: {
          ampacity_amps: number | null
          backup_class: string | null
          completion_percent: number
          conductor_count: number | null
          conductor_material: string | null
          conductor_size: string | null
          created_at: string
          critical: boolean | null
          demand_basis: string | null
          demand_va: number | null
          description: string | null
          dest_endpoint_ref: string | null
          dest_endpoint_type: string | null
          dest_panel_uuid: string | null
          feeder_id: string
          future: boolean | null
          ground_conductor: string | null
          id: string
          install_status: string
          label_status: string
          measured_length_ft: number | null
          neutral_conductor: string | null
          notes: string | null
          ocp_rating_amps: number | null
          ocp_type: string | null
          ods_extras: string | null
          phase: string | null
          planned_length_ft: number | null
          raceway_ref: string | null
          raceway_uuid: string | null
          service_type: string | null
          source_endpoint_ref: string | null
          source_endpoint_type: string | null
          source_panel_uuid: string | null
          updated_at: string
          user_id: string
          voltage: number | null
        }
        Insert: {
          ampacity_amps?: number | null
          backup_class?: string | null
          completion_percent?: number
          conductor_count?: number | null
          conductor_material?: string | null
          conductor_size?: string | null
          created_at?: string
          critical?: boolean | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          dest_panel_uuid?: string | null
          feeder_id: string
          future?: boolean | null
          ground_conductor?: string | null
          id?: string
          install_status?: string
          label_status?: string
          measured_length_ft?: number | null
          neutral_conductor?: string | null
          notes?: string | null
          ocp_rating_amps?: number | null
          ocp_type?: string | null
          ods_extras?: string | null
          phase?: string | null
          planned_length_ft?: number | null
          raceway_ref?: string | null
          raceway_uuid?: string | null
          service_type?: string | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_panel_uuid?: string | null
          updated_at?: string
          user_id: string
          voltage?: number | null
        }
        Update: {
          ampacity_amps?: number | null
          backup_class?: string | null
          completion_percent?: number
          conductor_count?: number | null
          conductor_material?: string | null
          conductor_size?: string | null
          created_at?: string
          critical?: boolean | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          dest_panel_uuid?: string | null
          feeder_id?: string
          future?: boolean | null
          ground_conductor?: string | null
          id?: string
          install_status?: string
          label_status?: string
          measured_length_ft?: number | null
          neutral_conductor?: string | null
          notes?: string | null
          ocp_rating_amps?: number | null
          ocp_type?: string | null
          ods_extras?: string | null
          phase?: string | null
          planned_length_ft?: number | null
          raceway_ref?: string | null
          raceway_uuid?: string | null
          service_type?: string | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_panel_uuid?: string | null
          updated_at?: string
          user_id?: string
          voltage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_feeders_dest_panel_uuid_fkey"
            columns: ["dest_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_feeders_raceway_uuid_fkey"
            columns: ["raceway_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_raceways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_feeders_source_panel_uuid_fkey"
            columns: ["source_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_field_observations: {
        Row: {
          applied_at: string | null
          applied_previous_value: string | null
          applied_value: string | null
          apply_status: string | null
          canonical_value: string | null
          classification: string | null
          confidence: string | null
          created_at: string
          disposition: string
          farmops_value: string | null
          field: string
          id: string
          interpreted_value: string | null
          notes: string | null
          observed_at: string
          observed_text: string
          panel_ref: string | null
          panel_uuid: string | null
          photo_bucket: string | null
          photo_mime: string | null
          photo_name: string | null
          photo_path: string | null
          photo_size: number | null
          photo_uploaded_at: string | null
          poles: number | null
          position: number | null
          positions_text: string | null
          proposed_action: string | null
          scope: string | null
          side: string | null
          source_column: string | null
          source_photo: string | null
          source_row: number | null
          updated_at: string
          user_id: string
          verification_status: string | null
          workbook: string
          worksheet: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_previous_value?: string | null
          applied_value?: string | null
          apply_status?: string | null
          canonical_value?: string | null
          classification?: string | null
          confidence?: string | null
          created_at?: string
          disposition?: string
          farmops_value?: string | null
          field: string
          id?: string
          interpreted_value?: string | null
          notes?: string | null
          observed_at?: string
          observed_text: string
          panel_ref?: string | null
          panel_uuid?: string | null
          photo_bucket?: string | null
          photo_mime?: string | null
          photo_name?: string | null
          photo_path?: string | null
          photo_size?: number | null
          photo_uploaded_at?: string | null
          poles?: number | null
          position?: number | null
          positions_text?: string | null
          proposed_action?: string | null
          scope?: string | null
          side?: string | null
          source_column?: string | null
          source_photo?: string | null
          source_row?: number | null
          updated_at?: string
          user_id: string
          verification_status?: string | null
          workbook: string
          worksheet?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_previous_value?: string | null
          applied_value?: string | null
          apply_status?: string | null
          canonical_value?: string | null
          classification?: string | null
          confidence?: string | null
          created_at?: string
          disposition?: string
          farmops_value?: string | null
          field?: string
          id?: string
          interpreted_value?: string | null
          notes?: string | null
          observed_at?: string
          observed_text?: string
          panel_ref?: string | null
          panel_uuid?: string | null
          photo_bucket?: string | null
          photo_mime?: string | null
          photo_name?: string | null
          photo_path?: string | null
          photo_size?: number | null
          photo_uploaded_at?: string | null
          poles?: number | null
          position?: number | null
          positions_text?: string | null
          proposed_action?: string | null
          scope?: string | null
          side?: string | null
          source_column?: string | null
          source_photo?: string | null
          source_row?: number | null
          updated_at?: string
          user_id?: string
          verification_status?: string | null
          workbook?: string
          worksheet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_field_observations_panel_uuid_fkey"
            columns: ["panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_intertie_configurations: {
        Row: {
          capacity_amps: number | null
          commissioned_date: string | null
          created_at: string
          effective_date: string | null
          endpoint_a_panel_uuid: string | null
          endpoint_a_ref: string | null
          endpoint_a_service_uuid: string | null
          endpoint_b_panel_uuid: string | null
          endpoint_b_ref: string | null
          endpoint_b_service_uuid: string | null
          id: string
          intertie_ref: string | null
          intertie_uuid: string
          is_current: boolean
          isolation_method: string | null
          lifecycle_state: string
          normal_state: string | null
          notes: string | null
          ods_extras: string | null
          permitted_states: string | null
          retired_date: string | null
          revision_label: string | null
          transfer_method: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capacity_amps?: number | null
          commissioned_date?: string | null
          created_at?: string
          effective_date?: string | null
          endpoint_a_panel_uuid?: string | null
          endpoint_a_ref?: string | null
          endpoint_a_service_uuid?: string | null
          endpoint_b_panel_uuid?: string | null
          endpoint_b_ref?: string | null
          endpoint_b_service_uuid?: string | null
          id?: string
          intertie_ref?: string | null
          intertie_uuid: string
          is_current?: boolean
          isolation_method?: string | null
          lifecycle_state?: string
          normal_state?: string | null
          notes?: string | null
          ods_extras?: string | null
          permitted_states?: string | null
          retired_date?: string | null
          revision_label?: string | null
          transfer_method?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capacity_amps?: number | null
          commissioned_date?: string | null
          created_at?: string
          effective_date?: string | null
          endpoint_a_panel_uuid?: string | null
          endpoint_a_ref?: string | null
          endpoint_a_service_uuid?: string | null
          endpoint_b_panel_uuid?: string | null
          endpoint_b_ref?: string | null
          endpoint_b_service_uuid?: string | null
          id?: string
          intertie_ref?: string | null
          intertie_uuid?: string
          is_current?: boolean
          isolation_method?: string | null
          lifecycle_state?: string
          normal_state?: string | null
          notes?: string | null
          ods_extras?: string | null
          permitted_states?: string | null
          retired_date?: string | null
          revision_label?: string | null
          transfer_method?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_intertie_configurations_endpoint_a_panel_uuid_fkey"
            columns: ["endpoint_a_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_intertie_configurations_endpoint_a_service_uuid_fkey"
            columns: ["endpoint_a_service_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_intertie_configurations_endpoint_b_panel_uuid_fkey"
            columns: ["endpoint_b_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_intertie_configurations_endpoint_b_service_uuid_fkey"
            columns: ["endpoint_b_service_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_intertie_configurations_intertie_uuid_fkey"
            columns: ["intertie_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_interties"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_interties: {
        Row: {
          created_at: string
          id: string
          intertie_id: string
          name: string | null
          notes: string | null
          ods_extras: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          intertie_id: string
          name?: string | null
          notes?: string | null
          ods_extras?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          intertie_id?: string
          name?: string | null
          notes?: string | null
          ods_extras?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_junction_boxes: {
        Row: {
          box_type: string | null
          building: string | null
          completion_percent: number
          created_at: string
          description: string | null
          dimensions: string | null
          elevation_zone: string | null
          field_grid_reference: string | null
          grid: string | null
          id: string
          install_status: string
          jbox_id: string
          label_status: string
          notes: string | null
          ods_extras: string | null
          pole_location_kind: string | null
          pole_ref_end: string | null
          pole_ref_start: string | null
          pole_scheme: string | null
          raceway_ref: string | null
          raceway_sequence: number | null
          raceway_uuid: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          box_type?: string | null
          building?: string | null
          completion_percent?: number
          created_at?: string
          description?: string | null
          dimensions?: string | null
          elevation_zone?: string | null
          field_grid_reference?: string | null
          grid?: string | null
          id?: string
          install_status?: string
          jbox_id: string
          label_status?: string
          notes?: string | null
          ods_extras?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          raceway_ref?: string | null
          raceway_sequence?: number | null
          raceway_uuid?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          box_type?: string | null
          building?: string | null
          completion_percent?: number
          created_at?: string
          description?: string | null
          dimensions?: string | null
          elevation_zone?: string | null
          field_grid_reference?: string | null
          grid?: string | null
          id?: string
          install_status?: string
          jbox_id?: string
          label_status?: string
          notes?: string | null
          ods_extras?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          raceway_ref?: string | null
          raceway_sequence?: number | null
          raceway_uuid?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_junction_boxes_raceway_uuid_fkey"
            columns: ["raceway_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_raceways"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_labels: {
        Row: {
          created_at: string
          entity_kind: string
          entity_stable_id: string
          id: string
          installed_at: string | null
          label_class: string
          notes: string | null
          printed_at: string | null
          queued_at: string
          reprint_required: boolean
          state: string
          template_version: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_kind: string
          entity_stable_id: string
          id?: string
          installed_at?: string | null
          label_class: string
          notes?: string | null
          printed_at?: string | null
          queued_at?: string
          reprint_required?: boolean
          state?: string
          template_version?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_kind?: string
          entity_stable_id?: string
          id?: string
          installed_at?: string | null
          label_class?: string
          notes?: string | null
          printed_at?: string | null
          queued_at?: string
          reprint_required?: boolean
          state?: string
          template_version?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_loads: {
        Row: {
          amps: number | null
          amps_semantic:
            | Database["public"]["Enums"]["electrical_amps_semantic"]
            | null
          amps_semantic_provenance: string | null
          area: string | null
          backup_eligible: boolean | null
          backup_panel: string | null
          backup_priority: string | null
          circuit_group_ref: string | null
          circuit_group_uuid: string | null
          completion_percent: number
          connected_load_current: number | null
          connected_va: number | null
          continuous_load: boolean | null
          count: number
          created_at: string
          critical: boolean | null
          dedicated: boolean | null
          dedicated_shared: string | null
          demand_basis: string | null
          demand_va: number | null
          description: string | null
          design_circuit_ampacity: number | null
          design_grid: string | null
          design_x_ft: number | null
          design_y_ft: number | null
          equipment_fla: number | null
          equipment_model: string | null
          field_grid_reference: string | null
          field_verification_status: string | null
          future: boolean | null
          grid: string | null
          grid_migration_provenance: string | null
          grid_reference: string | null
          grid_reference_precision: string | null
          id: string
          install_status: string
          installed_ocp_rating: number | null
          label_status: string
          legacy_grid: string | null
          load_id: string
          load_shed_group: string | null
          location: string | null
          location_evidence: string | null
          location_x_ft: number | null
          location_y_ft: number | null
          maximum_overcurrent_protection: number | null
          minimum_circuit_ampacity: number | null
          nameplate_applied_by: string | null
          nameplate_captured_at: string | null
          nameplate_fla_rla: string | null
          nameplate_manufacturer: string | null
          nameplate_mca: string | null
          nameplate_mocp: string | null
          nameplate_model: string | null
          nameplate_phase: string | null
          nameplate_serial: string | null
          nameplate_source: string | null
          nameplate_volts: string | null
          notes: string | null
          ods_extras: string | null
          phase: string | null
          pole_location_kind: string | null
          pole_ref_end: string | null
          pole_ref_start: string | null
          pole_scheme: string | null
          rated_current_amps: number | null
          rated_load_amps: number | null
          source_circuit: string | null
          source_reference: string | null
          suggested_panel: string | null
          updated_at: string
          user_id: string
          verification_notes: string | null
          verified_at: string | null
          volts: number | null
        }
        Insert: {
          amps?: number | null
          amps_semantic?:
            | Database["public"]["Enums"]["electrical_amps_semantic"]
            | null
          amps_semantic_provenance?: string | null
          area?: string | null
          backup_eligible?: boolean | null
          backup_panel?: string | null
          backup_priority?: string | null
          circuit_group_ref?: string | null
          circuit_group_uuid?: string | null
          completion_percent?: number
          connected_load_current?: number | null
          connected_va?: number | null
          continuous_load?: boolean | null
          count?: number
          created_at?: string
          critical?: boolean | null
          dedicated?: boolean | null
          dedicated_shared?: string | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          design_circuit_ampacity?: number | null
          design_grid?: string | null
          design_x_ft?: number | null
          design_y_ft?: number | null
          equipment_fla?: number | null
          equipment_model?: string | null
          field_grid_reference?: string | null
          field_verification_status?: string | null
          future?: boolean | null
          grid?: string | null
          grid_migration_provenance?: string | null
          grid_reference?: string | null
          grid_reference_precision?: string | null
          id?: string
          install_status?: string
          installed_ocp_rating?: number | null
          label_status?: string
          legacy_grid?: string | null
          load_id: string
          load_shed_group?: string | null
          location?: string | null
          location_evidence?: string | null
          location_x_ft?: number | null
          location_y_ft?: number | null
          maximum_overcurrent_protection?: number | null
          minimum_circuit_ampacity?: number | null
          nameplate_applied_by?: string | null
          nameplate_captured_at?: string | null
          nameplate_fla_rla?: string | null
          nameplate_manufacturer?: string | null
          nameplate_mca?: string | null
          nameplate_mocp?: string | null
          nameplate_model?: string | null
          nameplate_phase?: string | null
          nameplate_serial?: string | null
          nameplate_source?: string | null
          nameplate_volts?: string | null
          notes?: string | null
          ods_extras?: string | null
          phase?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          rated_current_amps?: number | null
          rated_load_amps?: number | null
          source_circuit?: string | null
          source_reference?: string | null
          suggested_panel?: string | null
          updated_at?: string
          user_id: string
          verification_notes?: string | null
          verified_at?: string | null
          volts?: number | null
        }
        Update: {
          amps?: number | null
          amps_semantic?:
            | Database["public"]["Enums"]["electrical_amps_semantic"]
            | null
          amps_semantic_provenance?: string | null
          area?: string | null
          backup_eligible?: boolean | null
          backup_panel?: string | null
          backup_priority?: string | null
          circuit_group_ref?: string | null
          circuit_group_uuid?: string | null
          completion_percent?: number
          connected_load_current?: number | null
          connected_va?: number | null
          continuous_load?: boolean | null
          count?: number
          created_at?: string
          critical?: boolean | null
          dedicated?: boolean | null
          dedicated_shared?: string | null
          demand_basis?: string | null
          demand_va?: number | null
          description?: string | null
          design_circuit_ampacity?: number | null
          design_grid?: string | null
          design_x_ft?: number | null
          design_y_ft?: number | null
          equipment_fla?: number | null
          equipment_model?: string | null
          field_grid_reference?: string | null
          field_verification_status?: string | null
          future?: boolean | null
          grid?: string | null
          grid_migration_provenance?: string | null
          grid_reference?: string | null
          grid_reference_precision?: string | null
          id?: string
          install_status?: string
          installed_ocp_rating?: number | null
          label_status?: string
          legacy_grid?: string | null
          load_id?: string
          load_shed_group?: string | null
          location?: string | null
          location_evidence?: string | null
          location_x_ft?: number | null
          location_y_ft?: number | null
          maximum_overcurrent_protection?: number | null
          minimum_circuit_ampacity?: number | null
          nameplate_applied_by?: string | null
          nameplate_captured_at?: string | null
          nameplate_fla_rla?: string | null
          nameplate_manufacturer?: string | null
          nameplate_mca?: string | null
          nameplate_mocp?: string | null
          nameplate_model?: string | null
          nameplate_phase?: string | null
          nameplate_serial?: string | null
          nameplate_source?: string | null
          nameplate_volts?: string | null
          notes?: string | null
          ods_extras?: string | null
          phase?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          rated_current_amps?: number | null
          rated_load_amps?: number | null
          source_circuit?: string | null
          source_reference?: string | null
          suggested_panel?: string | null
          updated_at?: string
          user_id?: string
          verification_notes?: string | null
          verified_at?: string | null
          volts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_loads_circuit_group_uuid_fkey"
            columns: ["circuit_group_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_circuit_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_nameplate_write_requests: {
        Row: {
          applied_at: string | null
          applied_fields: Json | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          load_label: string | null
          load_ref: string | null
          load_uuid: string
          proposed: Json
          request_note: string | null
          requested_by: string
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_fields?: Json | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          load_label?: string | null
          load_ref?: string | null
          load_uuid: string
          proposed?: Json
          request_note?: string | null
          requested_by: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_fields?: Json | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          load_label?: string | null
          load_ref?: string | null
          load_uuid?: string
          proposed?: Json
          request_note?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_nameplate_write_requests_load_uuid_fkey"
            columns: ["load_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_loads"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_naming_standards: {
        Row: {
          body: string
          created_at: string
          key: string
          sort_order: number
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          key: string
          sort_order?: number
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          key?: string
          sort_order?: number
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      electrical_panel_edit_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          expires_at: string | null
          id: string
          panel_id: string
          reason: string | null
          requester_email: string | null
          requester_id: string
          revoked_at: string | null
          scope: string
          scope_detail: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expires_at?: string | null
          id?: string
          panel_id: string
          reason?: string | null
          requester_email?: string | null
          requester_id?: string
          revoked_at?: string | null
          scope?: string
          scope_detail?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          expires_at?: string | null
          id?: string
          panel_id?: string
          reason?: string | null
          requester_email?: string | null
          requester_id?: string
          revoked_at?: string | null
          scope?: string
          scope_detail?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: []
      }
      electrical_panel_exits: {
        Row: {
          completion_percent: number | null
          created_at: string
          exit_order: number
          exit_side: string | null
          id: string
          install_status: string | null
          label_status: string | null
          notes: string | null
          panel_uuid: string
          raceway_ref: string | null
          raceway_uuid: string | null
          trade_size: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completion_percent?: number | null
          created_at?: string
          exit_order: number
          exit_side?: string | null
          id?: string
          install_status?: string | null
          label_status?: string | null
          notes?: string | null
          panel_uuid: string
          raceway_ref?: string | null
          raceway_uuid?: string | null
          trade_size?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completion_percent?: number | null
          created_at?: string
          exit_order?: number
          exit_side?: string | null
          id?: string
          install_status?: string | null
          label_status?: string | null
          notes?: string | null
          panel_uuid?: string
          raceway_ref?: string | null
          raceway_uuid?: string | null
          trade_size?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_panel_exits_panel_uuid_fkey"
            columns: ["panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_panel_exits_raceway_uuid_fkey"
            columns: ["raceway_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_raceways"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_panels: {
        Row: {
          backup_class: string | null
          breaker_columns: number | null
          building: string | null
          bus_rating_amps: number | null
          circuits: number | null
          completion_percent: number
          created_at: string
          description: string | null
          design_grid: string | null
          design_x_ft: number | null
          design_y_ft: number | null
          feeder_source: string | null
          field_grid_reference: string | null
          field_verification_status: string | null
          grid: string | null
          grid_migration_provenance: string | null
          grid_reference: string | null
          grid_reference_precision: string | null
          id: string
          install_status: string
          label_status: string
          legacy_grid: string | null
          location_evidence: string | null
          location_x_ft: number | null
          location_y_ft: number | null
          notes: string | null
          ods_extras: string | null
          panel_id: string
          phase: string | null
          pole_location_kind: string | null
          pole_ref_end: string | null
          pole_ref_start: string | null
          pole_scheme: string | null
          positions_per_column: number | null
          spaces: number | null
          system_voltage: Json | null
          system_voltage_applied_at: string | null
          updated_at: string
          user_id: string
          verification_notes: string | null
          verified_at: string | null
          voltage: number | null
        }
        Insert: {
          backup_class?: string | null
          breaker_columns?: number | null
          building?: string | null
          bus_rating_amps?: number | null
          circuits?: number | null
          completion_percent?: number
          created_at?: string
          description?: string | null
          design_grid?: string | null
          design_x_ft?: number | null
          design_y_ft?: number | null
          feeder_source?: string | null
          field_grid_reference?: string | null
          field_verification_status?: string | null
          grid?: string | null
          grid_migration_provenance?: string | null
          grid_reference?: string | null
          grid_reference_precision?: string | null
          id?: string
          install_status?: string
          label_status?: string
          legacy_grid?: string | null
          location_evidence?: string | null
          location_x_ft?: number | null
          location_y_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          panel_id: string
          phase?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          positions_per_column?: number | null
          spaces?: number | null
          system_voltage?: Json | null
          system_voltage_applied_at?: string | null
          updated_at?: string
          user_id: string
          verification_notes?: string | null
          verified_at?: string | null
          voltage?: number | null
        }
        Update: {
          backup_class?: string | null
          breaker_columns?: number | null
          building?: string | null
          bus_rating_amps?: number | null
          circuits?: number | null
          completion_percent?: number
          created_at?: string
          description?: string | null
          design_grid?: string | null
          design_x_ft?: number | null
          design_y_ft?: number | null
          feeder_source?: string | null
          field_grid_reference?: string | null
          field_verification_status?: string | null
          grid?: string | null
          grid_migration_provenance?: string | null
          grid_reference?: string | null
          grid_reference_precision?: string | null
          id?: string
          install_status?: string
          label_status?: string
          legacy_grid?: string | null
          location_evidence?: string | null
          location_x_ft?: number | null
          location_y_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          panel_id?: string
          phase?: string | null
          pole_location_kind?: string | null
          pole_ref_end?: string | null
          pole_ref_start?: string | null
          pole_scheme?: string | null
          positions_per_column?: number | null
          spaces?: number | null
          system_voltage?: Json | null
          system_voltage_applied_at?: string | null
          updated_at?: string
          user_id?: string
          verification_notes?: string | null
          verified_at?: string | null
          voltage?: number | null
        }
        Relationships: []
      }
      electrical_peer_sync_config: {
        Row: {
          batches_staged_total: number
          created_at: string
          enabled: boolean
          id: string
          last_error: string | null
          last_result: Json | null
          last_run_at: string | null
          last_success_at: string | null
          max_batches_per_run: number
          peer_base_url: string
          run_as_user_id: string
          updated_at: string
        }
        Insert: {
          batches_staged_total?: number
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_result?: Json | null
          last_run_at?: string | null
          last_success_at?: string | null
          max_batches_per_run?: number
          peer_base_url: string
          run_as_user_id: string
          updated_at?: string
        }
        Update: {
          batches_staged_total?: number
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_result?: Json | null
          last_run_at?: string | null
          last_success_at?: string | null
          max_batches_per_run?: number
          peer_base_url?: string
          run_as_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      electrical_power_assets: {
        Row: {
          asset_ref: string | null
          asset_type: string
          asset_uuid: string | null
          building: string | null
          capacity_note: string | null
          completion_percent: number | null
          created_at: string
          description: string | null
          grid: string | null
          id: string
          input_current_amps: number | null
          input_type: string | null
          input_voltage: number | null
          install_status: string
          label_status: string
          location_note: string | null
          manufacturer: string | null
          model: string | null
          notes: string | null
          output_current_amps: number | null
          output_type: string | null
          output_voltage: number | null
          power_asset_id: string
          rack_ref: string | null
          rack_uuid: string | null
          source_branch_ref: string | null
          source_branch_uuid: string | null
          source_circuit_group_ref: string | null
          source_circuit_group_uuid: string | null
          source_load_ref: string | null
          source_load_uuid: string | null
          source_panel_ref: string | null
          source_panel_uuid: string | null
          updated_at: string
          upstream_power_asset_ref: string | null
          upstream_power_asset_uuid: string | null
          user_id: string
        }
        Insert: {
          asset_ref?: string | null
          asset_type?: string
          asset_uuid?: string | null
          building?: string | null
          capacity_note?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          grid?: string | null
          id?: string
          input_current_amps?: number | null
          input_type?: string | null
          input_voltage?: number | null
          install_status?: string
          label_status?: string
          location_note?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          output_current_amps?: number | null
          output_type?: string | null
          output_voltage?: number | null
          power_asset_id: string
          rack_ref?: string | null
          rack_uuid?: string | null
          source_branch_ref?: string | null
          source_branch_uuid?: string | null
          source_circuit_group_ref?: string | null
          source_circuit_group_uuid?: string | null
          source_load_ref?: string | null
          source_load_uuid?: string | null
          source_panel_ref?: string | null
          source_panel_uuid?: string | null
          updated_at?: string
          upstream_power_asset_ref?: string | null
          upstream_power_asset_uuid?: string | null
          user_id: string
        }
        Update: {
          asset_ref?: string | null
          asset_type?: string
          asset_uuid?: string | null
          building?: string | null
          capacity_note?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          grid?: string | null
          id?: string
          input_current_amps?: number | null
          input_type?: string | null
          input_voltage?: number | null
          install_status?: string
          label_status?: string
          location_note?: string | null
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          output_current_amps?: number | null
          output_type?: string | null
          output_voltage?: number | null
          power_asset_id?: string
          rack_ref?: string | null
          rack_uuid?: string | null
          source_branch_ref?: string | null
          source_branch_uuid?: string | null
          source_circuit_group_ref?: string | null
          source_circuit_group_uuid?: string | null
          source_load_ref?: string | null
          source_load_uuid?: string | null
          source_panel_ref?: string | null
          source_panel_uuid?: string | null
          updated_at?: string
          upstream_power_asset_ref?: string | null
          upstream_power_asset_uuid?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_power_assets_asset_uuid_fkey"
            columns: ["asset_uuid"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_rack_uuid_fkey"
            columns: ["rack_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_racks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_source_branch_uuid_fkey"
            columns: ["source_branch_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_branch_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_source_circuit_group_uuid_fkey"
            columns: ["source_circuit_group_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_circuit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_source_load_uuid_fkey"
            columns: ["source_load_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_source_panel_uuid_fkey"
            columns: ["source_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_power_assets_upstream_power_asset_uuid_fkey"
            columns: ["upstream_power_asset_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_power_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_raceway_waypoints: {
        Row: {
          created_at: string
          direction: string | null
          grid: string | null
          id: string
          label: string | null
          notes: string | null
          raceway_id: string
          sequence: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          direction?: string | null
          grid?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          raceway_id: string
          sequence?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string | null
          grid?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          raceway_id?: string
          sequence?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_raceway_waypoints_raceway_id_fkey"
            columns: ["raceway_id"]
            isOneToOne: false
            referencedRelation: "electrical_raceways"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_raceways: {
        Row: {
          circuit_refs: string | null
          completion_percent: number
          conduit_id: string
          created_at: string
          description: string | null
          dest_building: string | null
          dest_endpoint_ref: string | null
          dest_endpoint_type: string | null
          dest_grid: string | null
          dest_jbox_uuid: string | null
          dest_panel_uuid: string | null
          environment: string
          exit_notes: string | null
          exit_order: number | null
          exit_side: string | null
          from_label: string | null
          id: string
          install_status: string
          label_status: string
          material: string | null
          measured_length_ft: number | null
          notes: string | null
          ods_extras: string | null
          planned_length_ft: number | null
          purpose: string | null
          raceway_type: string | null
          route_group: string | null
          service_type: string | null
          source_building: string | null
          source_endpoint_ref: string | null
          source_endpoint_type: string | null
          source_grid: string | null
          source_jbox_uuid: string | null
          source_panel_uuid: string | null
          spare: boolean | null
          to_label: string | null
          trade_size: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          circuit_refs?: string | null
          completion_percent?: number
          conduit_id: string
          created_at?: string
          description?: string | null
          dest_building?: string | null
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          dest_grid?: string | null
          dest_jbox_uuid?: string | null
          dest_panel_uuid?: string | null
          environment?: string
          exit_notes?: string | null
          exit_order?: number | null
          exit_side?: string | null
          from_label?: string | null
          id?: string
          install_status?: string
          label_status?: string
          material?: string | null
          measured_length_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          planned_length_ft?: number | null
          purpose?: string | null
          raceway_type?: string | null
          route_group?: string | null
          service_type?: string | null
          source_building?: string | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_grid?: string | null
          source_jbox_uuid?: string | null
          source_panel_uuid?: string | null
          spare?: boolean | null
          to_label?: string | null
          trade_size?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          circuit_refs?: string | null
          completion_percent?: number
          conduit_id?: string
          created_at?: string
          description?: string | null
          dest_building?: string | null
          dest_endpoint_ref?: string | null
          dest_endpoint_type?: string | null
          dest_grid?: string | null
          dest_jbox_uuid?: string | null
          dest_panel_uuid?: string | null
          environment?: string
          exit_notes?: string | null
          exit_order?: number | null
          exit_side?: string | null
          from_label?: string | null
          id?: string
          install_status?: string
          label_status?: string
          material?: string | null
          measured_length_ft?: number | null
          notes?: string | null
          ods_extras?: string | null
          planned_length_ft?: number | null
          purpose?: string | null
          raceway_type?: string | null
          route_group?: string | null
          service_type?: string | null
          source_building?: string | null
          source_endpoint_ref?: string | null
          source_endpoint_type?: string | null
          source_grid?: string | null
          source_jbox_uuid?: string | null
          source_panel_uuid?: string | null
          spare?: boolean | null
          to_label?: string | null
          trade_size?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_raceways_dest_jbox_uuid_fkey"
            columns: ["dest_jbox_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_junction_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_raceways_dest_panel_uuid_fkey"
            columns: ["dest_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_raceways_source_jbox_uuid_fkey"
            columns: ["source_jbox_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_junction_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_raceways_source_panel_uuid_fkey"
            columns: ["source_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_racks: {
        Row: {
          asset_ref: string | null
          asset_uuid: string | null
          building: string | null
          completion_percent: number | null
          created_at: string
          description: string | null
          grid: string | null
          id: string
          install_status: string
          label_status: string
          location_note: string | null
          mounting: string | null
          notes: string | null
          rack_id: string
          rack_role: string | null
          rack_size_u: number | null
          site_area: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_ref?: string | null
          asset_uuid?: string | null
          building?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          grid?: string | null
          id?: string
          install_status?: string
          label_status?: string
          location_note?: string | null
          mounting?: string | null
          notes?: string | null
          rack_id: string
          rack_role?: string | null
          rack_size_u?: number | null
          site_area?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_ref?: string | null
          asset_uuid?: string | null
          building?: string | null
          completion_percent?: number | null
          created_at?: string
          description?: string | null
          grid?: string | null
          id?: string
          install_status?: string
          label_status?: string
          location_note?: string | null
          mounting?: string | null
          notes?: string | null
          rack_id?: string
          rack_role?: string | null
          rack_size_u?: number | null
          site_area?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_racks_asset_uuid_fkey"
            columns: ["asset_uuid"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_scan_grants: {
        Row: {
          created_at: string
          first_scanned_at: string
          id: string
          panel_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_scanned_at?: string
          id?: string
          panel_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          first_scanned_at?: string
          id?: string
          panel_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      electrical_service_configurations: {
        Row: {
          ampacity_amps: number | null
          commissioned_date: string | null
          created_at: string
          effective_date: string | null
          entry_point: string | null
          id: string
          is_current: boolean
          lifecycle_state: string
          meter_arrangement: string | null
          notes: string | null
          ods_extras: string | null
          phase: string | null
          retired_date: string | null
          revision_label: string | null
          service_equipment: string | null
          service_ref: string | null
          service_uuid: string
          updated_at: string
          user_id: string
          voltage: string | null
        }
        Insert: {
          ampacity_amps?: number | null
          commissioned_date?: string | null
          created_at?: string
          effective_date?: string | null
          entry_point?: string | null
          id?: string
          is_current?: boolean
          lifecycle_state?: string
          meter_arrangement?: string | null
          notes?: string | null
          ods_extras?: string | null
          phase?: string | null
          retired_date?: string | null
          revision_label?: string | null
          service_equipment?: string | null
          service_ref?: string | null
          service_uuid: string
          updated_at?: string
          user_id: string
          voltage?: string | null
        }
        Update: {
          ampacity_amps?: number | null
          commissioned_date?: string | null
          created_at?: string
          effective_date?: string | null
          entry_point?: string | null
          id?: string
          is_current?: boolean
          lifecycle_state?: string
          meter_arrangement?: string | null
          notes?: string | null
          ods_extras?: string | null
          phase?: string | null
          retired_date?: string | null
          revision_label?: string | null
          service_equipment?: string | null
          service_ref?: string | null
          service_uuid?: string
          updated_at?: string
          user_id?: string
          voltage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electrical_service_configurations_service_uuid_fkey"
            columns: ["service_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_services"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_service_panels: {
        Row: {
          created_at: string
          fed_from_kind: string | null
          fed_from_panel_ref: string | null
          fed_from_panel_uuid: string | null
          id: string
          notes: string | null
          panel_ampacity_amps: number | null
          panel_ref: string | null
          panel_uuid: string | null
          role: string | null
          sequence: number | null
          service_config_uuid: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fed_from_kind?: string | null
          fed_from_panel_ref?: string | null
          fed_from_panel_uuid?: string | null
          id?: string
          notes?: string | null
          panel_ampacity_amps?: number | null
          panel_ref?: string | null
          panel_uuid?: string | null
          role?: string | null
          sequence?: number | null
          service_config_uuid: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fed_from_kind?: string | null
          fed_from_panel_ref?: string | null
          fed_from_panel_uuid?: string | null
          id?: string
          notes?: string | null
          panel_ampacity_amps?: number | null
          panel_ref?: string | null
          panel_uuid?: string | null
          role?: string | null
          sequence?: number | null
          service_config_uuid?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrical_service_panels_fed_from_panel_uuid_fkey"
            columns: ["fed_from_panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_service_panels_panel_uuid_fkey"
            columns: ["panel_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_service_panels_service_config_uuid_fkey"
            columns: ["service_config_uuid"]
            isOneToOne: false
            referencedRelation: "electrical_service_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      electrical_services: {
        Row: {
          building: string | null
          created_at: string
          id: string
          name: string | null
          notes: string | null
          ods_extras: string | null
          service_id: string
          site_code: string | null
          updated_at: string
          user_id: string
          utility_account: string | null
        }
        Insert: {
          building?: string | null
          created_at?: string
          id?: string
          name?: string | null
          notes?: string | null
          ods_extras?: string | null
          service_id: string
          site_code?: string | null
          updated_at?: string
          user_id: string
          utility_account?: string | null
        }
        Update: {
          building?: string | null
          created_at?: string
          id?: string
          name?: string | null
          notes?: string | null
          ods_extras?: string | null
          service_id?: string
          site_code?: string | null
          updated_at?: string
          user_id?: string
          utility_account?: string | null
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
      inventory_components: {
        Row: {
          component_item_id: string
          created_at: string
          id: string
          notes: string | null
          parent_item_id: string
          quantity: number
          sort_order: number
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          component_item_id: string
          created_at?: string
          id?: string
          notes?: string | null
          parent_item_id: string
          quantity?: number
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          component_item_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          parent_item_id?: string
          quantity?: number
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_components_component_item_id_fkey"
            columns: ["component_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_components_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_import_snapshots: {
        Row: {
          created_at: string
          created_ids: string[]
          delete_missing: boolean
          deleted_rows: Json
          file_name: string
          id: string
          reverted_at: string | null
          stats: Json
          updated_at: string
          updated_before: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          created_ids?: string[]
          delete_missing?: boolean
          deleted_rows?: Json
          file_name?: string
          id?: string
          reverted_at?: string | null
          stats?: Json
          updated_at?: string
          updated_before?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          created_ids?: string[]
          delete_missing?: boolean
          deleted_rows?: Json
          file_name?: string
          id?: string
          reverted_at?: string | null
          stats?: Json
          updated_at?: string
          updated_before?: Json
          user_id?: string
        }
        Relationships: []
      }
      inventory_item_types: {
        Row: {
          active: boolean
          created_at: string
          folder: string
          label: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          folder: string
          label: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          active?: boolean
          created_at?: string
          folder?: string
          label?: string
          sort_order?: number
          updated_at?: string
          value?: string
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
      job_locks: {
        Row: {
          consecutive_failures: number
          created_at: string
          last_run_at: string | null
          locked_until: string | null
          name: string
          paused: boolean
          paused_reason: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          last_run_at?: string | null
          locked_until?: string | null
          name: string
          paused?: boolean
          paused_reason?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          last_run_at?: string | null
          locked_until?: string | null
          name?: string
          paused?: boolean
          paused_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kit_deployment_lines: {
        Row: {
          component_item_id: string | null
          component_name: string
          created_at: string
          deployment_id: string
          id: string
          quantity_out: number
          quantity_returned: number
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          component_item_id?: string | null
          component_name?: string
          created_at?: string
          deployment_id: string
          id?: string
          quantity_out?: number
          quantity_returned?: number
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          component_item_id?: string | null
          component_name?: string
          created_at?: string
          deployment_id?: string
          id?: string
          quantity_out?: number
          quantity_returned?: number
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kit_deployment_lines_component_item_id_fkey"
            columns: ["component_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_deployment_lines_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "kit_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      kit_deployments: {
        Row: {
          checked_out_at: string
          created_at: string
          id: string
          kit_item_id: string
          label: string
          notes: string | null
          returned_at: string | null
          status: string
          units: number
          updated_at: string
          user_id: string
        }
        Insert: {
          checked_out_at?: string
          created_at?: string
          id?: string
          kit_item_id: string
          label?: string
          notes?: string | null
          returned_at?: string | null
          status?: string
          units?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          checked_out_at?: string
          created_at?: string
          id?: string
          kit_item_id?: string
          label?: string
          notes?: string | null
          returned_at?: string | null
          status?: string
          units?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kit_deployments_kit_item_id_fkey"
            columns: ["kit_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
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
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
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
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
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
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
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
      task_health_runs: {
        Row: {
          applied: boolean
          created_at: string
          drift: Json
          drift_fixed: number
          error: string | null
          id: string
          merges: Json
          merges_applied: number
          ran_at: string
          scanned_tasks: number
          status: string
          title_cleanups: Json
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          drift?: Json
          drift_fixed?: number
          error?: string | null
          id?: string
          merges?: Json
          merges_applied?: number
          ran_at?: string
          scanned_tasks?: number
          status?: string
          title_cleanups?: Json
          trigger?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          drift?: Json
          drift_fixed?: number
          error?: string | null
          id?: string
          merges?: Json
          merges_applied?: number
          ran_at?: string
          scanned_tasks?: number
          status?: string
          title_cleanups?: Json
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_ui_preferences: {
        Row: {
          created_at: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferences?: Json
          updated_at?: string
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
      electrical_allowed: { Args: { _domain: string }; Returns: string[] }
      list_peer_sync_cron_secrets: {
        Args: { _actor: string }
        Returns: {
          activated_at: string
          fingerprint: string
          id: string
          note: string
          retire_after: string
          revoked_at: string
          status: string
        }[]
      }
      restore_table_diagnostics: { Args: { _table: string }; Returns: Json }
      revoke_retiring_peer_sync_cron_secrets: {
        Args: { _actor: string }
        Returns: number
      }
      rotate_peer_sync_cron_secret: {
        Args: { _actor: string; _grace_minutes?: number }
        Returns: {
          fingerprint: string
          retire_after: string
          retired_fingerprint: string
        }[]
      }
      verify_peer_sync_cron_secret: {
        Args: { _secret: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "viewer" | "editor" | "admin" | "electrician"
      approval_status: "pending" | "approved" | "rejected"
      electrical_amps_semantic:
        | "CONNECTED_LOAD_CURRENT"
        | "EQUIPMENT_FLA"
        | "RATED_CURRENT"
        | "RLA"
        | "MCA"
        | "MOCP"
        | "INSTALLED_OCP_RATING"
        | "DESIGN_CIRCUIT_AMPACITY"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["viewer", "editor", "admin", "electrician"],
      approval_status: ["pending", "approved", "rejected"],
      electrical_amps_semantic: [
        "CONNECTED_LOAD_CURRENT",
        "EQUIPMENT_FLA",
        "RATED_CURRENT",
        "RLA",
        "MCA",
        "MOCP",
        "INSTALLED_OCP_RATING",
        "DESIGN_CIRCUIT_AMPACITY",
      ],
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

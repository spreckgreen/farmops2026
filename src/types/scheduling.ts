export interface ServiceSchedule {
  id: string;
  user_id: string;
  asset_id: string;
  title: string;
  description: string | null;
  service_type: string;
  scheduled_date: string;
  completed_date: string | null;
  status: string;
  recurrence: string | null;
  consumables_used: ConsumableUsage[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset_name?: string;
}

export interface ConsumableUsage {
  consumable_id: string;
  name: string;
  quantity_used: number;
  unit: string;
}

export interface Consumable {
  id: string;
  user_id: string;
  name: string;
  unit: string | null;
  quantity_in_stock: number;
  min_quantity: number;
  cost_per_unit: number | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceScheduleFormData {
  asset_id: string;
  title: string;
  description: string;
  service_type: string;
  scheduled_date: string;
  recurrence: string;
  recurrence_interval: number;
  recurrence_unit: string;
  trigger_type: string;
  trigger_value: number;
  consumables_used: ConsumableUsage[];
  notes: string;
}

export interface ConsumableFormData {
  name: string;
  unit: string;
  quantity_in_stock: number;
  min_quantity: number;
  cost_per_unit: number;
  category: string;
}

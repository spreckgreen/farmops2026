export interface Asset {
  id: string;
  user_id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  location: string | null;
  quantity: number | null;
  min_quantity: number | null;
  status: string;
  tags: string[] | null;
  barcode: string | null;
  current_hours: number | null;
  current_miles: number | null;
  usage_tracking: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AssetFormData {
  name: string;
  description: string;
  category: string;
  location: string;
  quantity: number;
  min_quantity: number;
  status: string;
  tags: string[];
  barcode: string;
  current_hours: number;
  current_miles: number;
  usage_tracking: string;
}

ALTER TYPE public.summary_mode ADD VALUE IF NOT EXISTS 'daily_recap';
ALTER TYPE public.summary_mode ADD VALUE IF NOT EXISTS 'monthly_rollup';
ALTER TYPE public.summary_mode ADD VALUE IF NOT EXISTS 'yearly_rollup';
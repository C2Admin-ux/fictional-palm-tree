export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Database = {
  public: {
    Tables: {
      pmcs: {
        Row: { id: string; name: string; primary_contact_name: string | null; primary_contact_email: string | null; primary_contact_phone: string | null; agreement_start: string | null; fee_structure: string | null; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['pmcs']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['pmcs']['Row']>
      }
      properties: {
        Row: { id: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null; units_total: number | null; pmc_id: string | null; pms_platform: string | null; acquisition_date: string | null; status: 'active' | 'disposition' | 'watchlist'; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['properties']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['properties']['Row']>
      }
      user_profiles: {
        Row: { id: string; full_name: string | null; role: 'partner' | 'analyst' | 'viewer'; created_at: string }
        Insert: { id: string; full_name?: string | null; role?: 'partner' | 'analyst' | 'viewer' }
        Update: Partial<Database['public']['Tables']['user_profiles']['Row']>
      }
      contacts: {
        Row: { id: string; full_name: string; initials: string | null; role: string | null; email: string | null; phone: string | null; pmc_id: string | null; color_hex: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['contacts']['Row']> & { full_name: string }
        Update: Partial<Database['public']['Tables']['contacts']['Row']>
      }
      tasks: {
        Row: {
          id: string; title: string; description: string | null
          property_id: string | null; capex_project_id: string | null; deal_id: string | null
          status: 'inbox' | 'next_action' | 'waiting' | 'blocked' | 'done'
          priority: 'low' | 'medium' | 'high' | 'urgent'
          due_date: string | null; snoozed_until: string | null
          assigned_to: string | null; created_by: string | null; completed_at: string | null
          tags: string[]; blocked_by_task_id: string | null
          recur_freq: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annually' | 'custom' | null
          recur_interval: number | null; recur_unit: 'days' | 'weeks' | 'months' | null
          recur_end_type: 'never' | 'on' | 'after' | null
          recur_end_date: string | null; recur_end_count: number | null
          recur_count: number; recur_parent_id: string | null
          auto_source: string | null; source_record_id: string | null
          created_at: string; updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['tasks']['Row']> & { title: string }
        Update: Partial<Database['public']['Tables']['tasks']['Row']>
      }
      task_comments: {
        Row: { id: string; task_id: string; author_id: string | null; body: string; created_at: string }
        Insert: { task_id: string; body: string; author_id?: string | null }
        Update: Partial<Database['public']['Tables']['task_comments']['Row']>
      }
      task_contacts: {
        Row: { task_id: string; contact_id: string }
        Insert: { task_id: string; contact_id: string }
        Update: never
      }
      capex_projects: {
        Row: { id: string; property_id: string; title: string; category: string | null; status: 'planning' | 'approved' | 'in_progress' | 'complete' | 'on_hold'; priority: 'low' | 'medium' | 'high'; budget: number | null; committed: number | null; actual_spend: number | null; vendor_name: string | null; vendor_contact: string | null; start_date: string | null; target_completion: string | null; actual_completion: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['capex_projects']['Row']> & { property_id: string; title: string }
        Update: Partial<Database['public']['Tables']['capex_projects']['Row']>
      }
      capex_line_items: {
        Row: { id: string; project_id: string; description: string; vendor: string | null; amount: number; invoice_date: string | null; invoice_number: string | null; status: 'pending' | 'paid'; created_at: string }
        Insert: Partial<Database['public']['Tables']['capex_line_items']['Row']> & { project_id: string; description: string; amount: number }
        Update: Partial<Database['public']['Tables']['capex_line_items']['Row']>
      }
      pm_metrics: {
        Row: { id: string; property_id: string; period_month: string; occupancy_pct: number | null; leased_pct: number | null; delinquency_pct: number | null; delinquency_amount: number | null; noi_actual: number | null; noi_budget: number | null; gross_revenue_actual: number | null; gross_revenue_budget: number | null; work_orders_opened: number | null; work_orders_closed: number | null; avg_days_to_close: number | null; new_leases: number | null; renewals: number | null; move_ins: number | null; move_outs: number | null; response_time_hrs: number | null; notes: string | null; entered_by: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['pm_metrics']['Row']> & { property_id: string; period_month: string }
        Update: Partial<Database['public']['Tables']['pm_metrics']['Row']>
      }
      documents: {
        Row: { id: string; property_id: string | null; category: string; title: string; file_path: string; file_name: string | null; file_size_bytes: number | null; mime_type: string | null; expiration_date: string | null; notice_days: number | null; tags: string[]; uploaded_by: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['documents']['Row']> & { title: string; file_path: string; category: string }
        Update: Partial<Database['public']['Tables']['documents']['Row']>
      }
      insurance_policies: {
        Row: { id: string; property_id: string | null; policy_type: string; carrier: string; policy_number: string | null; agent_name: string | null; agent_phone: string | null; agent_email: string | null; broker_agency: string | null; per_occurrence: number | null; aggregate_limit: number | null; building_coverage: number | null; liability_coverage: number | null; loss_of_rents: number | null; deductible: number | null; additional_coverages: string | null; annual_premium: number | null; payment_freq: string | null; effective_date: string | null; expiry_date: string; renewal_notice_date: string | null; auto_renewal: boolean | null; coi_file_path: string | null; coi_file_name: string | null; certificate_holder: string | null; mortgagee: string | null; notes: string | null; status: 'active' | 'expired' | 'cancelled'; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['insurance_policies']['Row']> & { carrier: string; policy_type: string; expiry_date: string }
        Update: Partial<Database['public']['Tables']['insurance_policies']['Row']>
      }
      insurance_claims: {
        Row: { id: string; property_id: string | null; policy_id: string | null; claim_id: string | null; claim_type: string; status: string; unit_number: string | null; description: string | null; date_of_loss: string | null; date_reported: string | null; date_closed: string | null; amount_claimed: number | null; amount_approved: number | null; amount_paid: number | null; adjuster_name: string | null; adjuster_phone: string | null; adjuster_email: string | null; next_action: string | null; follow_up_date: string | null; priority: string; notes: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['insurance_claims']['Row']> & { claim_type: string }
        Update: Partial<Database['public']['Tables']['insurance_claims']['Row']>
      }
      inspections: {
        Row: { id: string; property_id: string; template_id: string | null; inspected_by: string | null; inspection_date: string; unit_number: string | null; area: string | null; status: 'draft' | 'submitted' | 'report_sent'; overall_rating: number | null; report_file_path: string | null; report_sent_at: string | null; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['inspections']['Row']> & { property_id: string }
        Update: Partial<Database['public']['Tables']['inspections']['Row']>
      }
      inspection_items: {
        Row: { id: string; inspection_id: string; section_name: string; item_label: string; rating: number | null; condition: string | null; notes: string | null; requires_action: boolean; action_priority: string | null; photo_paths: string[]; task_id: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['inspection_items']['Row']> & { inspection_id: string; section_name: string; item_label: string }
        Update: Partial<Database['public']['Tables']['inspection_items']['Row']>
      }
    }
    Views: {
      insurance_claims_view: { Row: Database['public']['Tables']['insurance_claims']['Row'] & { outstanding_balance: number | null; days_open: number | null } }
    }
    Functions: {
      current_user_role: { Args: Record<never, never>; Returns: string }
      create_expiration_tasks: { Args: Record<never, never>; Returns: Json }
    }
    Enums: Record<never, never>
  }
}

// Convenience aliases
export type Pmc = Database['public']['Tables']['pmcs']['Row']
export type Property = Database['public']['Tables']['properties']['Row']
export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type Contact = Database['public']['Tables']['contacts']['Row']
export type Task = Database['public']['Tables']['tasks']['Row']
export type TaskComment = Database['public']['Tables']['task_comments']['Row']
export type CapexProject = Database['public']['Tables']['capex_projects']['Row']
export type CapexLineItem = Database['public']['Tables']['capex_line_items']['Row']
export type PmMetric = Database['public']['Tables']['pm_metrics']['Row']
export type Document = Database['public']['Tables']['documents']['Row']
export type InsurancePolicy = Database['public']['Tables']['insurance_policies']['Row']
export type InsuranceClaim = Database['public']['Tables']['insurance_claims']['Row']
export type Inspection = Database['public']['Tables']['inspections']['Row']
export type InspectionItem = Database['public']['Tables']['inspection_items']['Row']

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Shape of the `properties.unit_mix` jsonb column (see building-tab.tsx)
export type UnitMix = { type: string; count: number; sf: number | null }[]

export type Database = {
  public: {
    Tables: {
      pmcs: {
        Row: { id: string; name: string; primary_contact_name: string | null; primary_contact_email: string | null; primary_contact_phone: string | null; agreement_start: string | null; fee_structure: string | null; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['pmcs']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['pmcs']['Row']>
        Relationships: []
      }
      properties: {
        Row: { id: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null; units_total: number | null; pmc_id: string | null; pms_platform: string | null; acquisition_date: string | null; status: 'active' | 'disposition' | 'watchlist'; notes: string | null; parcel_number: string | null; year_built: number | null; year_renovated: number | null; gross_sf: number | null; net_rentable_sf: number | null; land_acres: number | null; num_buildings: number | null; num_stories: number | null; parking_total: number | null; parking_covered: number | null; parking_uncovered: number | null; construction_type: string | null; roof_type: string | null; unit_mix: UnitMix | null; pca_report_date: string | null; pca_assessor: string | null; pca_file_path: string | null; pca_file_name: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['properties']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['properties']['Row']>
        Relationships: [{ foreignKeyName: 'properties_pmc_id_fkey'; columns: ['pmc_id']; isOneToOne: false; referencedRelation: 'pmcs'; referencedColumns: ['id'] }]
      }
      user_profiles: {
        Row: { id: string; full_name: string | null; role: 'partner' | 'analyst' | 'viewer'; created_at: string }
        Insert: { id: string; full_name?: string | null; role?: 'partner' | 'analyst' | 'viewer' }
        Update: Partial<Database['public']['Tables']['user_profiles']['Row']>
        Relationships: []
      }
      contacts: {
        Row: { id: string; full_name: string; initials: string | null; role: string | null; email: string | null; phone: string | null; pmc_id: string | null; color_hex: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['contacts']['Row']> & { full_name: string }
        Update: Partial<Database['public']['Tables']['contacts']['Row']>
        Relationships: []
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
          parent_task_id: string | null
          auto_source: string | null; source_record_id: string | null
          created_at: string; updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['tasks']['Row']> & { title: string }
        Update: Partial<Database['public']['Tables']['tasks']['Row']>
        Relationships: []
      }
      task_comments: {
        Row: { id: string; task_id: string; author_id: string | null; body: string; created_at: string }
        Insert: { task_id: string; body: string; author_id?: string | null }
        Update: Partial<Database['public']['Tables']['task_comments']['Row']>
        Relationships: []
      }
      task_contacts: {
        Row: { task_id: string; contact_id: string }
        Insert: { task_id: string; contact_id: string }
        Update: never
        Relationships: []
      }
      task_views: {
        Row: { id: string; user_id: string; name: string; config: Json; sort_order: number; created_at: string | null }
        Insert: Partial<Database['public']['Tables']['task_views']['Row']> & { user_id: string; name: string; config: Json }
        Update: Partial<Database['public']['Tables']['task_views']['Row']>
        Relationships: []
      }
      capex_projects: {
        Row: { id: string; property_id: string; title: string; category: string | null; status: 'planning' | 'approved' | 'in_progress' | 'complete' | 'on_hold'; priority: 'low' | 'medium' | 'high'; budget: number | null; committed: number | null; actual_spend: number | null; vendor_name: string | null; vendor_contact: string | null; start_date: string | null; target_completion: string | null; actual_completion: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['capex_projects']['Row']> & { property_id: string; title: string }
        Update: Partial<Database['public']['Tables']['capex_projects']['Row']>
        Relationships: [{ foreignKeyName: 'capex_projects_property_id_fkey'; columns: ['property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] }]
      }
      capex_line_items: {
        Row: { id: string; project_id: string; description: string; vendor: string | null; amount: number; invoice_date: string | null; invoice_number: string | null; status: 'pending' | 'paid'; created_at: string }
        Insert: Partial<Database['public']['Tables']['capex_line_items']['Row']> & { project_id: string; description: string; amount: number }
        Update: Partial<Database['public']['Tables']['capex_line_items']['Row']>
        Relationships: []
      }
      pm_metrics: {
        Row: { id: string; property_id: string; period_month: string; occupancy_pct: number | null; leased_pct: number | null; delinquency_pct: number | null; delinquency_amount: number | null; noi_actual: number | null; noi_budget: number | null; gross_revenue_actual: number | null; gross_revenue_budget: number | null; work_orders_opened: number | null; work_orders_closed: number | null; avg_days_to_close: number | null; new_leases: number | null; renewals: number | null; move_ins: number | null; move_outs: number | null; response_time_hrs: number | null; notes: string | null; entered_by: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['pm_metrics']['Row']> & { property_id: string; period_month: string }
        Update: Partial<Database['public']['Tables']['pm_metrics']['Row']>
        Relationships: []
      }
      documents: {
        Row: { id: string; property_id: string | null; category: string; title: string; file_path: string; file_name: string | null; file_size_bytes: number | null; mime_type: string | null; expiration_date: string | null; notice_days: number | null; tags: string[]; uploaded_by: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['documents']['Row']> & { title: string; file_path: string; category: string }
        Update: Partial<Database['public']['Tables']['documents']['Row']>
        Relationships: []
      }
      insurance_policies: {
        Row: { id: string; property_id: string | null; policy_type: string; carrier: string; policy_number: string | null; agent_name: string | null; agent_phone: string | null; agent_email: string | null; broker_agency: string | null; per_occurrence: number | null; aggregate_limit: number | null; building_coverage: number | null; liability_coverage: number | null; loss_of_rents: number | null; deductible: number | null; additional_coverages: string | null; annual_premium: number | null; payment_freq: string | null; effective_date: string | null; expiry_date: string; renewal_notice_date: string | null; auto_renewal: boolean | null; coi_file_path: string | null; coi_file_name: string | null; certificate_holder: string | null; mortgagee: string | null; notes: string | null; status: 'active' | 'expired' | 'cancelled' | 'archived'; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['insurance_policies']['Row']> & { carrier: string; policy_type: string; expiry_date: string }
        Update: Partial<Database['public']['Tables']['insurance_policies']['Row']>
        Relationships: [{ foreignKeyName: 'insurance_policies_property_id_fkey'; columns: ['property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] }]
      }
      insurance_claims: {
        Row: { id: string; property_id: string | null; policy_id: string | null; claim_id: string | null; claim_type: string; status: string; unit_number: string | null; description: string | null; date_of_loss: string | null; date_reported: string | null; date_closed: string | null; amount_claimed: number | null; amount_approved: number | null; amount_paid: number | null; adjuster_name: string | null; adjuster_phone: string | null; adjuster_email: string | null; next_action: string | null; follow_up_date: string | null; priority: string; notes: string | null; created_at: string; updated_at: string }
        Insert: Partial<Database['public']['Tables']['insurance_claims']['Row']> & { claim_type: string }
        Update: Partial<Database['public']['Tables']['insurance_claims']['Row']>
        Relationships: [
          { foreignKeyName: 'insurance_claims_property_id_fkey'; columns: ['property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] },
          { foreignKeyName: 'insurance_claims_policy_id_fkey'; columns: ['policy_id']; isOneToOne: false; referencedRelation: 'insurance_policies'; referencedColumns: ['id'] }
        ]
      }
      inspections: {
        Row: { id: string; property_id: string; template_id: string | null; inspected_by: string | null; inspection_date: string; inspection_type: 'site_visit' | 'annual'; unit_number: string | null; area: string | null; status: 'draft' | 'submitted' | 'report_sent'; overall_rating: number | null; report_file_path: string | null; report_sent_at: string | null; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['inspections']['Row']> & { property_id: string }
        Update: Partial<Database['public']['Tables']['inspections']['Row']>
        Relationships: []
      }
      inspection_items: {
        Row: { id: string; inspection_id: string; section_name: string; unit_number: string | null; item_label: string; rating: number | null; condition: string | null; notes: string | null; requires_action: boolean; action_priority: string | null; photo_paths: string[]; task_id: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['inspection_items']['Row']> & { inspection_id: string; section_name: string; item_label: string }
        Update: Partial<Database['public']['Tables']['inspection_items']['Row']>
        Relationships: []
      }
      contracts: {
        Row: {
          id: string; property_id: string | null; title: string; vendor_name: string; contract_type: string
          vendor_contact_name: string | null; vendor_contact_email: string | null; vendor_contact_phone: string | null
          account_number: string | null; agreement_number: string | null
          execution_date: string | null; commencement_date: string | null; expiration_date: string | null
          auto_renews: boolean | null; renewal_term_months: number | null
          cancel_notice_days: number | null; cancel_deadline: string | null; cancel_method: string | null
          monthly_cost: number | null; annual_cost: number | null; rate_escalation: string | null
          revenue_share_pct: number | null; revenue_share_details: string | null
          service_description: string | null; equipment_details: string | null; service_frequency: string | null
          service_line_items: string | null; per_service_cost: number | null; surcharges: string | null
          early_termination_terms: string | null; container_details: string | null; pickup_schedule: string | null
          inspection_frequency: string | null; coverage_scope: string | null; response_time_sla: string | null
          emergency_call_fee: number | null; file_path: string | null; file_name: string | null
          status: string; superseded_by: string | null; superseded_at: string | null; notes: string | null
          created_at: string; updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['contracts']['Row']> & { title: string; vendor_name: string; contract_type: string }
        Update: Partial<Database['public']['Tables']['contracts']['Row']>
        Relationships: [{ foreignKeyName: 'contracts_property_id_fkey'; columns: ['property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] }]
      }
      property_pca_items: {
        Row: { id: string; property_id: string; category: string; label: string; value: string | null; detail: string | null; est_cost: number | null; rul_years: number | null; sort_order: number; created_at: string }
        Insert: Partial<Database['public']['Tables']['property_pca_items']['Row']> & { property_id: string; category: string; label: string }
        Update: Partial<Database['public']['Tables']['property_pca_items']['Row']>
        Relationships: []
      }
      property_permits: {
        Row: { id: string; property_id: string; permit_no: string; permit_type: string | null; subtype: string | null; description: string | null; status: string | null; issued_date: string | null; expiration_date: string | null; address: string | null; source: string | null; notes: string | null; created_at: string }
        Insert: Partial<Database['public']['Tables']['property_permits']['Row']> & { property_id: string; permit_no: string }
        Update: Partial<Database['public']['Tables']['property_permits']['Row']>
        Relationships: [{ foreignKeyName: 'property_permits_property_id_fkey'; columns: ['property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] }]
      }
    }
    Views: {
      insurance_claims_view: { Row: Database['public']['Tables']['insurance_claims']['Row'] & { outstanding_balance: number | null; days_open: number | null }; Relationships: [] }
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
export type TaskView = Database['public']['Tables']['task_views']['Row']
export type CapexProject = Database['public']['Tables']['capex_projects']['Row']
export type CapexLineItem = Database['public']['Tables']['capex_line_items']['Row']
export type PmMetric = Database['public']['Tables']['pm_metrics']['Row']
export type Document = Database['public']['Tables']['documents']['Row']
export type InsurancePolicy = Database['public']['Tables']['insurance_policies']['Row']
export type InsuranceClaim = Database['public']['Tables']['insurance_claims']['Row']
export type Inspection = Database['public']['Tables']['inspections']['Row']
export type InspectionItem = Database['public']['Tables']['inspection_items']['Row']
export type Contract = Database['public']['Tables']['contracts']['Row']
export type PropertyPcaItem = Database['public']['Tables']['property_pca_items']['Row']
export type PropertyPermit = Database['public']['Tables']['property_permits']['Row']

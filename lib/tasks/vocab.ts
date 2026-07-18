// Single source for the tasks.auto_source vocabulary — the values the
// writers actually persist, shared with every reader (row badges, the
// agenda's obligations query, the obligations engine itself, the call
// confirm flow). A reader matching a value nothing writes (the old
// 'expiration' badge check) renders never; keeping the vocabulary here
// makes that class of drift impossible.

import type { Task } from '@/lib/supabase/types'

// The obligations engine's record-driven sources (app/api/tasks/expiration).
export const INSURANCE_SOURCE = 'insurance_expiry'
export const CONTRACT_SOURCE = 'contract_deadline'

// Seasonal bid-cycle sources (same engine, calendar-driven instead of
// record-driven): every fall each active property gets a "gather snow
// removal bids" task, every late winter a "gather landscaping bids" task.
// source_record_id is the property id; the season YEAR lives in due_date
// (see lib/tasks/seasonal.ts for the windows and dedupe rules).
export const SNOW_BIDS_SOURCE = 'seasonal_snow_bids'
export const LANDSCAPING_BIDS_SOURCE = 'seasonal_landscaping_bids'
export const SEASONAL_BID_SOURCES: string[] = [SNOW_BIDS_SOURCE, LANDSCAPING_BIDS_SOURCE]

export const OBLIGATION_SOURCES: string[] = [
  INSURANCE_SOURCE, CONTRACT_SOURCE, ...SEASONAL_BID_SOURCES,
]

// Tasks created from a confirmed call item (calls/[id] Confirm & process).
export const CALL_AUTO_SOURCE = 'call'

// The statuses that count as "open" work — everything but done. Shared
// by the extraction context and the agenda queries.
export const OPEN_STATUSES: Task['status'][] = ['inbox', 'next_action', 'waiting', 'blocked']

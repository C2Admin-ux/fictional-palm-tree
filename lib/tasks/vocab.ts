// Single source for the tasks.auto_source vocabulary — the values the
// writers actually persist, shared with every reader (row badges, the
// agenda's obligations query, the obligations engine itself, the call
// confirm flow). A reader matching a value nothing writes (the old
// 'expiration' badge check) renders never; keeping the vocabulary here
// makes that class of drift impossible.

// The obligations engine's two sources (app/api/tasks/expiration).
export const INSURANCE_SOURCE = 'insurance_expiry'
export const CONTRACT_SOURCE = 'contract_deadline'
export const OBLIGATION_SOURCES: string[] = [INSURANCE_SOURCE, CONTRACT_SOURCE]

// Tasks created from a confirmed call item (calls/[id] Confirm & process).
export const CALL_AUTO_SOURCE = 'call'

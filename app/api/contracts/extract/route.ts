import { NextRequest, NextResponse } from 'next/server'

// Extracts structured contract fields from a vendor contract / service agreement PDF.

export const maxDuration = 60

const EXTRACTION_PROMPT = `You are extracting structured data from a vendor contract or service agreement for a multifamily real estate firm. These are commonly laundry, trash/waste, pest control, landscaping, elevator, HVAC, plumbing, electrical, security, internet, or similar service agreements. The schema below covers ALL of these types — only fill the fields that apply to THIS contract, and use null for everything that doesn't. For example, a trash contract won't have revenue share; an elevator contract won't have containers.

Return ONLY a valid JSON object, no preamble.

{
  "title": string (short descriptive title, e.g. "Trash Removal Agreement", "Elevator Maintenance Contract"),
  "vendor_name": string,
  "contract_type": one of "laundry" | "trash" | "pest_control" | "landscaping" | "elevator" | "hvac" | "plumbing" | "electrical" | "security" | "internet" | "cable" | "parking" | "management" | "utility" | "other",
  "vendor_contact_name": string or null,
  "vendor_contact_email": string or null,
  "vendor_contact_phone": string or null,
  "account_number": string or null,
  "agreement_number": string or null,

  "execution_date": "YYYY-MM-DD" or null (signed date),
  "commencement_date": "YYYY-MM-DD" or null (service start),
  "expiration_date": "YYYY-MM-DD" or null (current term end — CRITICAL),
  "auto_renews": true | false | null,
  "renewal_term_months": number or null (each renewal term length; a "3-year" renewal = 36),

  "cancel_notice_days": number or null (days before expiration that notice must be given — CRITICAL. Convert months: 6mo=180, 3mo=90, 2mo=60, 30 days=30),
  "cancel_method": "certified_mail" | "email" | "written" | "any" or null,

  "monthly_cost": number or null (plain number, no $/commas),
  "annual_cost": number or null,
  "per_service_cost": number or null (per-haul, per-visit, or per-call charge if priced that way),
  "rate_escalation": string or null (e.g. "+10% 03/2027 and 03/2028", "CPI annually"),
  "surcharges": string or null (fuel recovery, environmental, admin/RPC fees and whether exempt — common on trash contracts),
  "early_termination_terms": string or null (liquidated damages / buyout / early-cancel penalty language),

  "service_frequency": string or null (e.g. "2x/week", "weekly", "monthly", "quarterly"),
  "service_description": string or null (what service is provided),
  "service_line_items": string or null (itemized services/equipment/units covered),

  // Trash / waste specific — null for other types
  "container_details": string or null (sizes and counts, e.g. "1x 3yd + 1x 4yd solid waste"),
  "pickup_schedule": string or null (e.g. "3yd 2x/week, 4yd 1x/week"),

  // Mechanical (elevator/HVAC/plumbing/electrical) — null for other types
  "inspection_frequency": string or null (e.g. "monthly", "annual state certification"),
  "coverage_scope": string or null (what's covered: "parts + labor", "labor only", key exclusions),
  "response_time_sla": string or null (e.g. "4hr emergency, next business day routine"),
  "emergency_call_fee": number or null (after-hours / emergency call-out fee),

  // Laundry specific — null for other types
  "revenue_share_pct": number or null (owner's percentage),
  "revenue_share_details": string or null,
  "equipment_details": string or null (machine makes/models/counts),

  "property_hint": string or null (property name or street address identifying which property this covers),
  "confidence": "high" | "medium" | "low",
  "notes": string or null (anything notable not captured above — right of first refusal, unusual terms, etc.)
}

Rules:
- Dates MUST be YYYY-MM-DD. Convert any format (e.g. "3/10/2026" -> "2026-03-10").
- Numbers plain (140.95, not "$140.95").
- The CANCELLATION / TERMINATION clause is the most important thing to get right — cancel_notice_days and cancel_method drive renewal-deadline alerts, and notice periods are often buried in a "Term" section expressed in months.
- Fill ONLY the fields relevant to this contract type; null everything else. Do not force laundry fields onto a trash contract or vice versa.
- Do not fabricate. If a field isn't present, null.
- If the document is not a contract, return {"error": "not_a_contract"}.

Return format: {"contracts": [ {...} ]}  (array even for a single contract)`

export async function POST(req: NextRequest) {
  try {
    const { pdf_base64, filename } = await req.json()
    if (!pdf_base64) {
      return NextResponse.json({ error: 'No PDF data provided' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        error: 'API key not configured',
        detail: 'ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.',
      }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 } },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', errText)
      return NextResponse.json({ error: 'Extraction failed', detail: errText }, { status: 502 })
    }

    const data = await response.json()
    const textContent = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse extraction result' }, { status: 502 })
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (parsed.error === 'not_a_contract') {
      return NextResponse.json({ error: 'not_a_contract', filename }, { status: 422 })
    }

    return NextResponse.json({ success: true, contracts: parsed.contracts ?? [], filename })

  } catch (err: any) {
    console.error('Contract extraction route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

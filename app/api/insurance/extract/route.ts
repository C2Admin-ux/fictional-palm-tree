import { NextRequest, NextResponse } from 'next/server'

// Extracts structured insurance policy fields from a COI / policy PDF.
// Receives base64 PDF, sends to Claude as a document, returns parsed JSON.

export const maxDuration = 60

const EXTRACTION_PROMPT = `You are extracting structured data from an insurance document (Certificate of Insurance, policy declaration page, or binder) for a multifamily real estate firm.

Extract the following fields. Return ONLY a valid JSON object, no preamble or explanation.

If a document contains MULTIPLE policies (common on ACORD COIs — e.g. General Liability + Umbrella + Property on one page), return an array with one object per policy. If a single policy, still return an array with one object.

For each policy, extract:
{
  "policy_type": one of "gl" | "property" | "umbrella" | "workers_comp" | "auto" | "other" (gl = general/commercial liability, property = property/all-risk/hazard),
  "carrier": string (the insurer name, e.g. "Scottsdale Insurance Company"),
  "policy_number": string or null,
  "effective_date": "YYYY-MM-DD" or null,
  "expiry_date": "YYYY-MM-DD" or null (the expiration date — critical field),
  "per_occurrence": number or null (each occurrence limit, as a plain number e.g. 1000000),
  "aggregate_limit": number or null (general aggregate),
  "building_coverage": number or null (for property policies),
  "deductible": number or null,
  "annual_premium": number or null,
  "agent_name": string or null (producer/agent contact name),
  "agent_phone": string or null,
  "agent_email": string or null,
  "broker_agency": string or null (the agency/brokerage name),
  "certificate_holder": string or null,
  "mortgagee": string or null (lender/mortgagee/loss payee if listed),
  "property_hint": string or null (any property name or street address mentioned that identifies which property this covers),
  "confidence": "high" | "medium" | "low" (your confidence in the extraction accuracy),
  "notes": string or null (anything notable — coverage exclusions, sub-limits, special conditions)
}

Rules:
- Dates MUST be YYYY-MM-DD format. Convert any format you see (e.g. "10/16/2025" becomes "2025-10-16").
- Numbers must be plain integers/decimals with no $ or commas (e.g. 1000000 not "$1,000,000").
- If you genuinely cannot find a field, use null. Do not guess or fabricate.
- If the document is not an insurance document at all, return {"error": "not_an_insurance_document"}.

Return format: {"policies": [ {...}, {...} ]}`

export async function POST(req: NextRequest) {
  try {
    const { pdf_base64, filename } = await req.json()

    if (!pdf_base64) {
      return NextResponse.json({ error: 'No PDF data provided' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdf_base64,
                },
              },
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
    const textContent = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    // Parse the JSON out of the response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse extraction result' }, { status: 502 })
    }

    const parsed = JSON.parse(jsonMatch[0])

    if (parsed.error === 'not_an_insurance_document') {
      return NextResponse.json({ error: 'not_an_insurance_document', filename }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      policies: parsed.policies ?? [],
      filename,
    })

  } catch (err: any) {
    console.error('Extraction route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

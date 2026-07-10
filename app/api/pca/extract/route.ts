import { NextRequest, NextResponse } from 'next/server'

// Extracts structured data from a Property Condition Assessment (PCA) /
// Property Condition Report (PCR) PDF.

export const maxDuration = 120

const EXTRACTION_PROMPT = `You are extracting structured data from a Property Condition Assessment (PCA), Property Condition Report (PCR), or engineering/building assessment for a multifamily apartment property.

Return ONLY a valid JSON object, no preamble.

Split what you find into (a) key building facts and (b) a flexible list of detailed line items.

{
  "facts": {
    "year_built": number or null,
    "year_renovated": number or null,
    "gross_sf": number or null (total gross building area, sq ft, plain number),
    "net_rentable_sf": number or null,
    "land_acres": number or null,
    "num_buildings": number or null,
    "num_stories": number or null,
    "parking_total": number or null,
    "parking_covered": number or null,
    "parking_uncovered": number or null,
    "construction_type": string or null (e.g. "wood frame", "masonry", "concrete"),
    "roof_type": string or null (e.g. "TPO membrane", "pitched asphalt shingle"),
    "unit_mix": [ {"type": "1x1", "count": number, "sf": number or null}, ... ] or null,
    "pca_report_date": "YYYY-MM-DD" or null (date the assessment was performed/issued),
    "pca_assessor": string or null (firm or inspector that produced the report),
    "confidence": "high" | "medium" | "low"
  },
  "items": [
    {
      "category": string (group it: "Site", "Structure", "Envelope", "Roof", "HVAC", "Plumbing", "Electrical", "Interiors", "Amenities", "ADA", "Immediate Repairs", "Remaining Useful Life", "Other"),
      "label": string (the item name, e.g. "Roof covering", "Boiler type & age", "Parking lot condition"),
      "value": string or null (the finding, e.g. "TPO, ~10 yrs", "Fair", "2 gas-fired boilers, 2015"),
      "detail": string or null (any extra note),
      "est_cost": number or null (estimated repair/replacement cost if given, plain number),
      "rul_years": number or null (remaining useful life in years if given)
    }
  ]
}

Rules:
- Numbers plain (no $ or commas). Dates YYYY-MM-DD.
- Put the big-picture building facts in "facts" and the detailed component-by-component findings in "items". It's fine for items to be long — capture immediate repairs and remaining-useful-life tables as individual items with est_cost / rul_years populated.
- For unit_mix, capture each unit type with its count and (if available) average square footage.
- Do not fabricate. Use null / omit when not present.
- If this is not a property condition/building assessment, return {"error": "not_a_pca"}.

Return the JSON object.`

export async function POST(req: NextRequest) {
  try {
    const { pdf_base64, filename } = await req.json()
    if (!pdf_base64) return NextResponse.json({ error: 'No PDF data provided' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        error: 'API key not configured',
        detail: 'ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.',
      }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
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
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse extraction result' }, { status: 502 })

    const parsed = JSON.parse(jsonMatch[0])
    if (parsed.error === 'not_a_pca') {
      return NextResponse.json({ error: 'not_a_pca', filename }, { status: 422 })
    }

    return NextResponse.json({ success: true, facts: parsed.facts ?? {}, items: parsed.items ?? [], filename })
  } catch (err: any) {
    console.error('PCA extraction route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

import type { TemplateSection } from '@/lib/inspections/templates'

// Section-instance logic shared by the capture page and the PDF report
// generator. A "section instance" = section name + optional unit number
// ("Vacant Unit · 204"); it is the unit of grouping for findings everywhere,
// so the PDF must group with exactly the same functions the app does.

export type SectionInstance = { name: string; unit: string | null }

// The minimal item shape these helpers need — satisfied by InspectionItem
// and by the lighter row types API routes and list pages select.
export type SectionedItem = { section_name: string; unit_number: string | null }

export const instanceKey = (name: string, unit: string | null) => `${name}|${unit ?? ''}`

export const instanceLabel = (s: SectionInstance) => s.unit ? `${s.name} · ${s.unit}` : s.name

// All section instances in display order: template sections first (each
// followed by its unit instances in the order captured), then any
// data-driven sections already on items even if not in the template.
export function buildSectionInstances(
  template: TemplateSection[],
  items: SectionedItem[],
): SectionInstance[] {
  const seen = new Set<string>()
  const out: SectionInstance[] = []
  const push = (name: string, unit: string | null) => {
    const key = instanceKey(name, unit)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name, unit })
  }
  for (const section of template) {
    push(section.name, null)
    // Unit instances of this duplicable section, in the order captured.
    for (const it of items) {
      if (it.section_name === section.name && it.unit_number) push(section.name, it.unit_number)
    }
  }
  // Data-driven: sections already on items even if not in the template.
  for (const it of items) push(it.section_name, it.unit_number)
  return out
}

// Finding counts keyed by instance key — drives the "(3)" counts in the
// capture form's section dropdown.
export function countItemsByInstance(items: SectionedItem[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const it of items) {
    const key = instanceKey(it.section_name, it.unit_number)
    map[key] = (map[key] ?? 0) + 1
  }
  return map
}

// Groups in template/instance order; only instances that actually have items.
export function groupItemsByInstance<T extends SectionedItem>(
  instances: SectionInstance[],
  items: T[],
): { inst: SectionInstance; items: T[] }[] {
  return instances
    .map(inst => ({
      inst,
      items: items.filter(it => instanceKey(it.section_name, it.unit_number) === instanceKey(inst.name, inst.unit)),
    }))
    .filter(g => g.items.length > 0)
}

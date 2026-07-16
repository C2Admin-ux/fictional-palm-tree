import { cn } from '@/lib/utils'
import { scoreGrade, GRADE_STYLES } from '@/lib/inspections/score'

// The score + grade pill ("B · 85") — single rendering of an inspection
// score, used on the inspections list and the property inspections tab.
export function GradeBadge({ score, className }: { score: number; className?: string }) {
  const grade = scoreGrade(score)
  return (
    <span className={cn('badge', GRADE_STYLES[grade], className)}>
      {grade} · {score}
    </span>
  )
}

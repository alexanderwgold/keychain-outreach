import { SparkleIcon } from "@/components/layout/sparkle-icon"

interface EmptyStateProps {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <SparkleIcon size={24} className="mb-3 text-kc-warm-gray-dark" />
      <p className="text-sm font-medium text-kc-charcoal">{title}</p>
      <p className="mt-1 text-xs text-kc-text-muted">{description}</p>
    </div>
  )
}

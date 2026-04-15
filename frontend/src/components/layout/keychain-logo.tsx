import { cn } from "@/lib/utils"
import { SparkleIcon } from "./sparkle-icon"

interface KeychainLogoProps {
  className?: string
  size?: "sm" | "md" | "lg"
  showSparkle?: boolean
}

const sizeMap = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
} as const

export function KeychainLogo({
  className,
  size = "md",
  showSparkle = true,
}: KeychainLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "font-bold tracking-tight text-kc-charcoal",
          sizeMap[size]
        )}
      >
        keychain
      </span>
      {showSparkle && (
        <SparkleIcon
          size={size === "sm" ? 10 : size === "md" ? 14 : 18}
          className="text-kc-gold"
        />
      )}
    </div>
  )
}

import { cn } from "@/lib/utils"

interface SparkleIconProps {
  className?: string
  size?: number
}

export function SparkleIcon({ className, size = 16 }: SparkleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-kc-gold", className)}
    >
      <path
        d="M8 0C8 0 9.5 5.5 8 8C6.5 10.5 0 8 0 8C0 8 6.5 9.5 8 8C9.5 6.5 8 0 8 0Z"
        fill="currentColor"
      />
      <path
        d="M8 16C8 16 6.5 10.5 8 8C9.5 5.5 16 8 16 8C16 8 9.5 6.5 8 8C6.5 9.5 8 16 8 16Z"
        fill="currentColor"
      />
    </svg>
  )
}

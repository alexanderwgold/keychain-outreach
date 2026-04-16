"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Mail } from "lucide-react"
import { DraftDrawer } from "./draft-drawer"

interface DraftTriggerProps {
  contactName: string
  contactTitle: string | null
  contactEmail: string | null
  accountName: string
  stageName: string
  opportunityId: string
  contactId: string
  repEmail: string
  size?: "sm" | "default"
  variant?: "outline" | "ghost"
  className?: string
}

export function DraftTrigger({
  contactName,
  contactTitle,
  contactEmail,
  accountName,
  stageName,
  opportunityId,
  contactId,
  repEmail,
  size = "sm",
  variant = "outline",
  className,
}: DraftTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <Mail className="h-3.5 w-3.5" />
        Draft
      </Button>
      <DraftDrawer
        open={open}
        onOpenChange={setOpen}
        contact={{ contactName, contactTitle, contactEmail, accountName, stageName, opportunityId, contactId, repEmail }}
      />
    </>
  )
}

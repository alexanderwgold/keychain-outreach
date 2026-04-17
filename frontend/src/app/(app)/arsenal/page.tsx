import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getRepArsenalItems } from "@/lib/data/arsenal"
import { RepArsenalClient } from "@/components/arsenal/rep-arsenal-client"

export default async function ArsenalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect("/")

  const { global, mine } = await getRepArsenalItems(user.email)
  const itemIds = [...global.map((i) => i.id), ...mine.map((i) => i.id)]

  return <RepArsenalClient globalItems={global} mineItems={mine} repEmail={user.email} itemIds={itemIds} />
}

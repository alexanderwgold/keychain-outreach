import { AppNav } from "@/components/layout/app-nav"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppNav />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}

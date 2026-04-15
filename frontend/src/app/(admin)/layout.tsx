export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Admin nav will be added later */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}

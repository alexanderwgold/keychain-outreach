export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav bar will be added in Task 8 */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}

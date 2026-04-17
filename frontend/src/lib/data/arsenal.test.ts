import { describe, it, expect, vi } from "vitest"
import { getRepArsenalItems } from "./arsenal"

const state = vi.hoisted(() => ({ callCount: 0 }))

vi.mock("server-only", () => ({}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn(() => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: any) => {
          const data = state.callCount++ === 0 ? [{ id: "a", visibility: "global" }] : []
          resolve({ data, error: null })
        },
      }
      return chain
    }),
  })),
}))

describe("getRepArsenalItems", () => {
  it("returns split global and mine arrays", async () => {
    const r = await getRepArsenalItems("rep@keychain.com")
    expect(r.global).toHaveLength(1)
    expect(r.mine).toHaveLength(0)
  })
})

import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { setWork } from "../create-case-store"
import { createCaseSession } from "../session"
import { fakeDeps, FILES, page } from "./helpers"

const saved = vi.hoisted(() => ({ files: [] as string[] }))
vi.mock("@/lib/save-file", () => ({ saveFile: (_bytes: unknown, name: string) => saved.files.push(name) }))
vi.mock("sonner", () => ({ toast: { info: () => undefined, error: () => undefined, success: () => undefined } }))

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget())
  saved.files.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
})

test("変換し直している間は、前の行を書き出さない（CSV・最後の Excel・問い合わせの Excel のどれも。控えも作らない）。終われば書き出せる", async () => {
  const uploadFile = vi.fn(fakeDeps().uploadFile)
  const s = createCaseSession(page(), fakeDeps({ uploadFile }), () => null)
  s.connect()
  await s.actions.openSource(FILES[0]!, true)
  await vi.waitFor(() => expect(s.table(s.store.getState()).hasTable).toBe(true))
  // 変換し直しを始めた状態にする（計画を変えたときと同じ。その間の表は前の行）
  setWork(s.store, (w) => ({ ...w, converted: false }))
  expect(s.table(s.store.getState()).reconverting).toBe(true)
  s.actions.downloadCsv()
  await s.actions.downloadFinalExcel()
  await s.actions.downloadInquiry()
  expect(saved.files).toEqual([])
  expect(uploadFile).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(s.table(s.store.getState()).reconverting).toBe(false))
  s.actions.downloadCsv()
  expect(saved.files).toHaveLength(1)
})

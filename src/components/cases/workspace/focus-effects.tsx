import { useEffect } from "react"
import { useCase, useCaseView } from "@/components/cases/store/context"
import type { ChatTarget } from "@/components/cases/store/create-case-store"

/**
 * チャットの欄の target（無ければ最初の答えを待つもの）と、その中の button のボタン（決めたボタンが無ければ無し。ほかのボタン〔答え〕に合わせて Enter で答えないように）
 */
export function chatTarget({ target, button }: ChatTarget) {
  const chat = '[data-testid="chat-column"]'
  const el = document.querySelector<HTMLElement>(`${chat} ${target}`) ?? document.querySelector<HTMLElement>(`${chat} [data-pending]`)
  return el && { el, button: el.querySelector<HTMLElement>(button ?? "button:not([disabled])") }
}

/**
 * DOM を動かすのはここだけ（ストアは DOM を触らない）:
 * - 作業の画面を重ねて開いたら作業の画面へ、閉じたら開く前の場所へフォーカスを戻す
 * - action の頼み（ui.focus）を、描いたあとの次の frame で動かす（チャットの欄の移り先・業種の一覧の行・職員が開いた／たたんだチャットの窓・「次は」で開いた段）。
 *   同じ描画で閉じた作業の画面・ダイアログがフォーカスを戻したあとに動くので、頼んだ先が勝つ
 */
export function FocusEffects() {
  const covered = useCaseView((v) => v.layout.covered)
  const focus = useCase((s) => s.ui.focus)
  useEffect(() => {
    if (!covered) return
    const before = document.activeElement as HTMLElement | null
    document.querySelector<HTMLElement>('[data-testid="work-frame"]')?.focus()
    return () => before?.focus()
  }, [covered])
  useEffect(() => {
    if (!focus) return
    requestAnimationFrame(() => {
      if (focus.kind === "chat") {
        const t = chatTarget(focus)
        if (!t) return
        t.el.scrollIntoView({ block: "center", behavior: "smooth" })
        t.button?.focus({ preventScroll: true })
        return
      }
      if (focus.kind === "chatWindow") {
        // 職員が開いたチャットの窓: 入力欄へ（送れない間は窓そのものへ）
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-column"] [data-testid="chat-input"]:not([disabled])')
        ;(input ?? document.querySelector<HTMLElement>('[data-testid="chat-column"]'))?.focus({ preventScroll: true })
        return
      }
      if (focus.kind === "chatLauncher") return document.querySelector<HTMLElement>('[data-testid="chat-launcher"]')?.focus()
      // 「済みました。次は ◯◯ →」で開いた段の中身へ（段の並びの横スクロールは step-bar.tsx が合わせる）
      if (focus.kind === "step") return document.querySelector<HTMLElement>(`[data-testid="work-panel"] [data-step-panel="${focus.id}"]`)?.focus({ preventScroll: true })
      // 業種の一覧のその行の選ぶ欄へ
      const row = document.querySelector<HTMLElement>(`[data-testid="gyoshu-list"] li[data-key="${CSS.escape(focus.key)}"]`)
      row?.scrollIntoView({ block: "nearest" })
      row?.querySelector<HTMLElement>('[data-testid="gyoshu-pick"]')?.focus({ preventScroll: true })
    })
  }, [focus])
  return null
}

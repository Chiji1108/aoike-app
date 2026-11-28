import { useCallback } from "react"

/** 重なる要素の左とのすき間（px） */
const GAP = 12
/** 空けても中身に残す幅（px。窓をほぼ横幅いっぱいに広げても、中身を細く押しつぶさない。その分は窓が覆う＝窓をたためば見える） */
const MIN_CONTENT = 320

/**
 * 上に重なる要素（案件の画面のチャットの窓など）が、この要素の右側に本当に重なっているときだけ、右をその分だけ空ける
 * （重なっていなければ空けない）。id の要素が when（CSS セレクター）に合う間だけ重なりとみなす（例: 窓の置き場で、たたんでいない）。
 * 窓の大きさ・置き場・たたみ・画面の大きさ・この要素の大きさが変わるたびに測り直す（中の行が増えたり消えたりしても、この要素の大きさが変わる）。
 * 置く要素は、上下に動かない所（表の上の行をまとめたかたまりなど。上の行が出入りすると下の行が動くので、行ごとには付けない）。
 * 窓の位置は offsetLeft・offsetTop で測る（開く・移る動きの途中の transform を含めない＝動き終わったあとの位置）。
 * 返す callback ref を要素に付ける。padding-right だけを直接書き換える（描き直さない）
 */
export function useRoomForOverlay(id: string, when: string) {
  return useCallback(
    (row: HTMLElement | null) => {
      const overlay = row && document.getElementById(id)
      if (!row || !overlay) return
      let frame = 0
      const measure = () => {
        const parent = overlay.offsetParent
        if (!parent || !overlay.matches(when)) return 0
        const p = parent.getBoundingClientRect()
        const left = p.left + overlay.offsetLeft
        const top = p.top + overlay.offsetTop
        const r = row.getBoundingClientRect()
        // 縦に重なり、右端が窓の左より右にある
        if (!(r.bottom > top && r.top < top + overlay.offsetHeight && r.right > left)) return 0
        return Math.max(0, Math.min(Math.ceil(r.right - left + GAP), Math.floor(r.width - MIN_CONTENT)))
      }
      const update = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const room = measure()
          const next = room ? `${room}px` : ""
          if (row.style.paddingRight !== next) row.style.paddingRight = next
        })
      }
      update()
      const resize = new ResizeObserver(update)
      resize.observe(row)
      resize.observe(overlay)
      // 窓の置き場・たたみが変わったら測り直す（大きさは上の ResizeObserver。動きの途中に毎フレーム書き換わる style は見ない）
      const mutation = new MutationObserver(update)
      mutation.observe(overlay, { attributes: true, attributeFilter: ["data-place", "data-collapsed"] })
      // 画面の大きさが変わると、窓（右下に留める）とこの要素の位置が変わる
      window.addEventListener("resize", update)
      return () => {
        cancelAnimationFrame(frame)
        resize.disconnect()
        mutation.disconnect()
        window.removeEventListener("resize", update)
      }
    },
    [id, when],
  )
}

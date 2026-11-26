/**
 * 案件の画面の並べ方（決まった処理）。チャットと作業の画面（表と各タブ）をどう置くかを、画面の幅・表があるか・職員が開いた／閉じたか・チャットの窓をたたんだかから決める。
 * 画面（workspace/case-layout.tsx）はこれを読んで置くだけにし、action（タブを開く・チャットへ移る・返事が届いた印）も同じ結果を読む
 */

/** 並べ方を決める入力 */
export type LayoutInput = {
  /** 作業の画面を画面いっぱいに置き、チャットを右下の窓にできる幅か */
  wide: boolean
  /** 表ができた（変換した、または足した行がある） */
  hasTable: boolean
  /** 作業の画面に出す表（行と出力）が揃った */
  workReady: boolean
  /** 職員が作業の画面を開いた（true）・閉じた（false）か。null は決めていない */
  workChoice: boolean | null
  /** チャットの窓をたたんでいる（右下の丸いボタンだけ。窓にしていないときは使わない） */
  chatCollapsed: boolean
}

/**
 * チャットの置き場: window は作業の画面の右下に重ねた窓（たためる）、full は画面の中央に大きく。
 * 窓は広い画面で作業の画面を開いているときだけ（表を横幅いっぱいに使う）。狭い画面は窓を置く幅が無いので、作業の画面を上に重ね、チャットは full のまま
 */
export type ChatPlace = "window" | "full"

export type CaseLayout = {
  /**
   * 作業の画面を置くか（表がある間は置いたまま、閉じても隠すだけ。表の検索・並べ替え・工事場所の調査の欄を消さない）と、
   * 置き方（inline は画面に横幅いっぱいに置く、overlay は画面の上に重ねる。幅が変わっても同じ要素のまま）。null は置かない
   */
  work: { place: "inline" | "overlay"; shown: boolean } | null
  /** 作業の画面を開いているか（表ができてから。チャットの「表を開く」・問い合わせの下書きの案内） */
  workShown: boolean
  chat: ChatPlace
  /** チャットを窓にしていて、たたんでいる（チャットから届いたものに未読の印を付ける。開くと消す） */
  chatCollapsed: boolean
  /** 作業の画面を重ねて開いている（うしろのチャットと見出しを触れなくし、作業の画面にフォーカスを移す） */
  covered: boolean
}

export function layoutOf({ wide, hasTable, workReady, workChoice, chatCollapsed }: LayoutInput): CaseLayout {
  const workShown = hasTable && (workChoice ?? wide)
  const work = hasTable && workReady ? { place: wide ? ("inline" as const) : ("overlay" as const), shown: workShown } : null
  const chat: ChatPlace = work?.shown && work.place === "inline" ? "window" : "full"
  return {
    work,
    workShown,
    chat,
    chatCollapsed: chat === "window" && chatCollapsed,
    covered: !!work?.shown && work.place === "overlay",
  }
}

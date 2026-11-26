/**
 * 案件の画面の並べ方（決まった処理）。チャットと作業の画面（表と各タブ）をどう置くかを、画面の幅・表があるか・職員が開いた／閉じたかから決める。
 * 画面（workspace/case-layout.tsx）はこれを読んで置くだけにし、action（タブを開く・チャットへ移る）も同じ結果を読む
 */

/** 並べ方を決める入力 */
export type LayoutInput = {
  /** 作業の画面をチャットの横に並べられる幅か */
  wide: boolean
  /** 表ができた（変換した、または足した行がある） */
  hasTable: boolean
  /** 作業の画面に出す表（行と出力）が揃った */
  workReady: boolean
  /** 職員が作業の画面を開いた（true）・閉じた（false）か。null は決めていない */
  workChoice: boolean | null
}

/**
 * チャットの置き場: column は作業の画面の横の細い列、full は画面の中央に大きく。
 * あとで「表があるときは右下の窓」を足すときは、ここに window を足し（たたんでいるか・未読の印は ui に持つ）、case-layout.tsx に置き方を1つ足す
 */
export type ChatPlace = "column" | "full"

export type CaseLayout = {
  /**
   * 作業の画面を置くか（表がある間は置いたまま、閉じても隠すだけ。表の検索・並べ替え・工事場所の調査の欄を消さない）と、
   * 置き方（side はチャットの右に並べる、overlay は画面の上に重ねる。幅が変わっても同じ要素のまま）。null は置かない
   */
  work: { place: "side" | "overlay"; shown: boolean } | null
  /** 作業の画面を開いているか（表ができてから。チャットの「表を開く」・問い合わせの下書きの案内） */
  workShown: boolean
  chat: ChatPlace
  /** 作業の画面を重ねて開いている（うしろのチャットと見出しを触れなくし、作業の画面にフォーカスを移す） */
  covered: boolean
}

export function layoutOf({ wide, hasTable, workReady, workChoice }: LayoutInput): CaseLayout {
  const workShown = hasTable && (workChoice ?? wide)
  const work = hasTable && workReady ? { place: wide ? ("side" as const) : ("overlay" as const), shown: workShown } : null
  return {
    work,
    workShown,
    chat: work?.shown && work.place === "side" ? "column" : "full",
    covered: !!work?.shown && work.place === "overlay",
  }
}

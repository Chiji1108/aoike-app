export const OFFICE_NAME = "行政書士青池事務所"
/** app.aoike.jp 全体（ポータル・ログイン）の名前 */
export const APP_NAME = "青池事務所"
/** 勤怠のページの名前 */
export const KINTAI_NAME = "青池事務所 勤怠"
/** 工事経歴書 CSV のページの名前 */
export const CSV_NAME = "青池事務所 工事経歴CSV"

/** 使う Claude のモデル（工事経歴書 CSV の変換・チャット・工事場所の調査） */
export const MODEL = "claude-opus-5-5"

/** 公開URL。ここ以外のホスト名（下の LEGACY_HOSTS）で来たら、こちらへ転送する */
export const APP_ORIGIN = "https://app.aoike.jp"

/**
 * app.aoike.jp にまとめる前のホスト名と、まとめた後の行き先のパス。
 * 古いホスト名で来たアクセスは APP_ORIGIN の行き先へ転送する（src/lib/legacy-host.ts）。
 */
export const LEGACY_HOSTS: Record<string, string> = {
  "kintai.aoike.jp": "/kintai",
  "csv.aoike.jp": "/csv",
}

/**
 * ユーザーの役割。今は事務所アカウント（office）だけ。
 * SHARP 用の閲覧アカウントなどを足すときにここへ追加し、src/server/middleware.ts で使える範囲を分ける。
 */
export const USER_ROLES = ["office"] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * 事務所共通アカウントのメールアドレス（固定・ユーザーには表示しない）。
 * 将来、個別アカウントに移行する場合はログイン画面でメールアドレスを入力させる形に拡張する。
 */
export const OFFICE_ACCOUNT_EMAIL = "office@aoike.internal"
export const OFFICE_ACCOUNT_NAME = "青池事務所"

/** 入力時の初期値（前回の入力がない場合に使用） */
export const DEFAULT_ENTRY = {
  startTime: "09:00",
  endTime: "16:00",
  breakMinutes: 60,
  overtimeMinutes: 0,
} as const

import { APP_ORIGIN, LEGACY_HOSTS } from "./constants"

/**
 * app.aoike.jp にまとめる前のホスト名（kintai.aoike.jp など）で来たアクセスの転送先。
 * 古いホスト名でなければ null。
 *
 * パスはツールの下へ移す（kintai.aoike.jp/report?… → app.aoike.jp/kintai/report?…）。
 * ログインは全ツール共通なので、/login はそのまま app.aoike.jp/login へ送る。
 */
export function legacyRedirectUrl(url: URL): string | null {
  const base = LEGACY_HOSTS[url.hostname]
  if (base === undefined) return null
  const path = url.pathname === "/" ? base : url.pathname === "/login" ? "/login" : `${base}${url.pathname}`
  return `${APP_ORIGIN}${path}${url.search}`
}

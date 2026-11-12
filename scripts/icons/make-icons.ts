/**
 * アプリのアイコン（public/ の favicon.svg・icon-*.png・apple-touch-icon.png）を作る
 *
 *   pnpm run icons
 *
 * 「青池」の文字を Noto Serif JP（Black）の図形（パス）にして描く。パソコンの書体に左右されないよう、
 * 文字はフォントではなく図形で持つ。フォントは Google Fonts から「青池」の2文字分だけ取ってくる。
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import opentype from "opentype.js"

const TEXT = "青池"
const NAVY = "#2b3a55"
const OUT = join(import.meta.dirname, "../../public")

async function loadFont() {
  // User-Agent を付けないと、Google Fonts は TrueType（opentype.js で読める形）で返す
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@900&text=${encodeURIComponent(TEXT)}`)
  ).text()
  const url = css.match(/url\((https:[^)]+)\)/)?.[1]
  if (!url) throw new Error(`フォントの URL が見つかりません:\n${css}`)
  return opentype.parse(await (await fetch(url)).arrayBuffer())
}

const font = await loadFont()

/** 一辺 size の正方形に、文字の幅が size * widthRatio になるよう中央に置いたパス */
function textPath(size: number, widthRatio: number) {
  const b = font.getPath(TEXT, 0, 0, 100).getBoundingBox()
  const scale = (size * widthRatio) / (b.x2 - b.x1)
  const x = (size - (b.x2 - b.x1) * scale) / 2 - b.x1 * scale
  const y = (size - (b.y2 - b.y1) * scale) / 2 - b.y1 * scale
  return font.getPath(TEXT, x, y, 100 * scale).toPathData(2)
}

function svg(size: number, { radius, widthRatio }: { radius: number; widthRatio: number }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${NAVY}"/><path d="${textPath(size, widthRatio)}" fill="#fff"/></svg>`
}

function png(svgText: string, width: number) {
  return new Resvg(svgText, { fitTo: { mode: "width", value: width } }).render().asPng()
}

// 角丸のアイコン（デスクトップ・タスクバー）
const rounded = svg(512, { radius: 112, widthRatio: 0.78 })
// 角を切らない正方形。OS が丸や角丸に切り抜くので、文字は中央 80% の円に収める
const maskable = svg(512, { radius: 0, widthRatio: 0.6 })
// iPhone のホーム画面（iOS が角丸にする）
const apple = svg(180, { radius: 0, widthRatio: 0.7 })
// ブラウザのタブ。小さく表示されるので文字を大きめに
const favicon = svg(64, { radius: 14, widthRatio: 0.86 })

writeFileSync(join(OUT, "favicon.svg"), favicon)
writeFileSync(join(OUT, "icon-192.png"), png(rounded, 192))
writeFileSync(join(OUT, "icon-512.png"), png(rounded, 512))
writeFileSync(join(OUT, "icon-maskable-512.png"), png(maskable, 512))
writeFileSync(join(OUT, "apple-touch-icon.png"), png(apple, 180))
console.log("✔ public/ にアイコンを書き出しました")

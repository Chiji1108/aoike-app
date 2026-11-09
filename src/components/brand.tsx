import { cn } from "@/lib/utils"

/** 事務所のマーク（紺地に「青池」）。アプリのアイコンと同じ public/favicon.svg（bun run icons で作る） */
export function BrandMark({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" aria-hidden className={cn("size-8 rounded-lg shadow-sm", className)} />
}

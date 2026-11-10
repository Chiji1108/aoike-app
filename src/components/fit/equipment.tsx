import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import type { FitCase } from "@/db/fit-schema"
import { errorMessage } from "@/lib/errors"
import { EQUIPMENT_KINDS, EQUIPMENT_KIND_LABELS, equipmentTotals, outputKwOf, type Equipment, type EquipmentKind } from "@/lib/fit/checks"
import { saveEquipmentFn, updateCaseFn } from "@/server/fit-fns"
import { caseInput, caseValues } from "./case-fields"

type Row = { kind: EquipmentKind; maker: string; model: string; watts: string; count: string }

const toRow = (e: Equipment): Row => ({ ...e, watts: String(e.watts), count: String(e.count) })
const toItem = (r: Row): Equipment => ({ ...r, watts: Number(r.watts), count: Number(r.count) })
const emptyRow = (kind: EquipmentKind): Row => ({ kind, maker: "", model: "", watts: "", count: kind === "pcs" ? "1" : "" })

/** 設備（割付図のパネル・パワコンの型式と数量）。出力はパネルの合計とパワコンの合計の小さいほう（小数第2位で切り捨て） */
export function EquipmentEditor({ fitCase, equipment, onChanged }: { fitCase: FitCase; equipment: Equipment[]; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => (equipment.length ? equipment.map(toRow) : [emptyRow("panel"), emptyRow("pcs")]))
  const [saving, setSaving] = useState(false)
  const filled = rows.filter((r) => r.watts.trim() || r.count.trim() || r.model.trim())
  const items = filled.filter((r) => Number(r.watts) > 0 && Number(r.count) > 0).map(toItem)
  const totals = equipmentTotals(items)
  const kw = outputKwOf(items)
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save(useOutput: boolean) {
    setSaving(true)
    try {
      await saveEquipmentFn({ data: { caseId: fitCase.id, items: filled.map(toItem) } })
      if (useOutput && kw !== null) await updateCaseFn({ data: { id: fitCase.id, fitCase: { ...caseInput(caseValues(fitCase)), outputKw: kw } } })
      toast.success(useOutput ? `設備を保存し、出力を ${kw?.toFixed(1)}kW にしました` : "設備を保存しました")
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-5 text-sm" data-testid="fit-equipment">
      <h2 className="font-semibold">設備（割付図）</h2>
      <ul className="grid gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-1.5">
            <NativeSelect aria-label="種類" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as EquipmentKind })} className="[&_select]:h-8">
              {EQUIPMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EQUIPMENT_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label="型式" placeholder="型式" value={r.model} onChange={(e) => set(i, { model: e.target.value })} className="h-8" data-testid="equip-model" />
            <Button variant="ghost" size="icon-sm" aria-label="この行を消す" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
            <span />
            <span className="flex items-center gap-1.5">
              <Input aria-label="1つの出力（W）" inputMode="numeric" placeholder="W" value={r.watts} onChange={(e) => set(i, { watts: e.target.value })} className="h-8 w-20 num" data-testid="equip-watts" />
              <span className="text-xs text-muted-foreground">W ×</span>
              <Input aria-label="数" inputMode="numeric" placeholder="数" value={r.count} onChange={(e) => set(i, { count: e.target.value })} className="h-8 w-16 num" data-testid="equip-count" />
              <span className="text-xs text-muted-foreground">{r.kind === "panel" ? "枚" : "台"}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow("panel")])}>
          <Plus />
          パネル
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow("pcs")])}>
          <Plus />
          パワコン
        </Button>
      </div>
      <p className="text-xs text-muted-foreground num" data-testid="equip-total">
        パネル {totals.panel.toLocaleString("ja-JP")}W・パワコン {totals.pcs.toLocaleString("ja-JP")}W → 出力 {kw === null ? "—" : `${kw.toFixed(1)}kW`}
        {kw !== null && fitCase.outputKw !== null && kw !== fitCase.outputKw && <span className="ml-1 text-red-700 dark:text-red-400">（案件の出力 {fitCase.outputKw}kW と違う）</span>}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={saving} onClick={() => save(false)} data-testid="equip-save">
          {saving && <Loader2 className="animate-spin" />}
          保存
        </Button>
        <Button size="sm" disabled={saving || kw === null || kw === fitCase.outputKw} onClick={() => save(true)} data-testid="equip-use-output">
          保存して出力に入れる
        </Button>
      </div>
    </section>
  )
}

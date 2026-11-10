import { createServerFn } from "@tanstack/react-start"
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm"
import { z } from "zod"
import { getKintaiDb } from "@/db"
import { attendanceRecords, employees } from "@/db/kintai-schema"
import { DATE_RE, PERIOD_KEY_RE, getPeriodRange } from "@/lib/period"
import { TIME_RE, timeToMinutes } from "@/lib/time"
import { authMiddleware } from "./middleware"

const recordColumns = {
  id: attendanceRecords.id,
  workDate: attendanceRecords.workDate,
  startTime: attendanceRecords.startTime,
  endTime: attendanceRecords.endTime,
  breakMinutes: attendanceRecords.breakMinutes,
  overtimeMinutes: attendanceRecords.overtimeMinutes,
  note: attendanceRecords.note,
  commuteFare: attendanceRecords.commuteFare,
}

export type AttendanceRow = {
  id: string
  workDate: string
  startTime: string
  endTime: string
  breakMinutes: number
  overtimeMinutes: number
  note: string
  commuteFare: number
}

/** 指定従業員・期間の勤怠一覧（一覧・集計・PDF出力で共通） */
export const getPeriodAttendance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ employeeId: z.string().min(1), period: z.string().regex(PERIOD_KEY_RE) }))
  .handler(async ({ data }) => {
    const db = getKintaiDb()
    const { start, end } = getPeriodRange(data.period)
    const [employee] = await db
      .select({
        id: employees.id,
        name: employees.name,
        active: employees.active,
        commuteType: employees.commuteType,
        commuteRoute: employees.commuteRoute,
        commuteOneWayFare: employees.commuteOneWayFare,
        commutePassMonthly: employees.commutePassMonthly,
      })
      .from(employees)
      .where(eq(employees.id, data.employeeId))
    if (!employee) throw new Error("従業員が見つかりません")

    const records: AttendanceRow[] = await db
      .select(recordColumns)
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.employeeId, data.employeeId),
          gte(attendanceRecords.workDate, start),
          lte(attendanceRecords.workDate, end),
        ),
      )
      .orderBy(asc(attendanceRecords.workDate))

    // 新規入力時の初期値に使う「前回の入力」
    const [last] = await db
      .select({
        startTime: attendanceRecords.startTime,
        endTime: attendanceRecords.endTime,
        breakMinutes: attendanceRecords.breakMinutes,
      })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.employeeId, data.employeeId))
      .orderBy(desc(attendanceRecords.updatedAt))
      .limit(1)

    return { employee, records, lastEntry: last ?? null }
  })

const minutes = z.number().int().min(0).max(24 * 60)

const recordInput = z
  .object({
    id: z.string().optional(),
    employeeId: z.string().min(1),
    workDate: z.string().regex(DATE_RE, "日付を正しく入力してください"),
    startTime: z.string().regex(TIME_RE, "出勤時刻を正しく入力してください"),
    endTime: z.string().regex(TIME_RE, "退勤時刻を正しく入力してください"),
    breakMinutes: minutes,
    overtimeMinutes: minutes,
    note: z.string().trim().max(200, "備考は200文字以内で入力してください").default(""),
    // 省略時（古い画面からの保存など）は既存の値を上書きしない
    commuteFare: z.number().int().min(0).max(100_000, "通勤費が大きすぎます").optional(),
  })
  .refine((v) => timeToMinutes(v.endTime) > timeToMinutes(v.startTime), {
    message: "退勤時刻は出勤時刻より後にしてください",
    path: ["endTime"],
  })
  .refine((v) => timeToMinutes(v.endTime) - timeToMinutes(v.startTime) >= v.breakMinutes, {
    message: "休憩時間が勤務時間を超えています",
    path: ["breakMinutes"],
  })

export type RecordInput = z.input<typeof recordInput>

export const saveAttendance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(recordInput)
  .handler(async ({ data }) => {
    const db = getKintaiDb()
    const { id, ...values } = data

    const [dup] = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.employeeId, values.employeeId),
          eq(attendanceRecords.workDate, values.workDate),
          id ? ne(attendanceRecords.id, id) : undefined,
        ),
      )
      .limit(1)
    if (dup) throw new Error("この日の勤怠はすでに登録されています")

    if (id) {
      await db.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, id))
      return { id }
    }
    const [created] = await db.insert(attendanceRecords).values(values).returning({ id: attendanceRecords.id })
    return created!
  })

export const deleteAttendance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await getKintaiDb().delete(attendanceRecords).where(eq(attendanceRecords.id, data.id))
    return { ok: true }
  })

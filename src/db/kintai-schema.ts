import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const COMMUTE_TYPES = ["none", "pass", "per_trip"] as const
export type CommuteType = (typeof COMMUTE_TYPES)[number]

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
}

/** 従業員（ログインアカウントとは独立） */
export const employees = sqliteTable("employees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  /** 無効化された従業員は選択肢に出さないが、勤怠データは保持する */
  active: integer("active", { mode: "boolean" }).default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  /** 通勤方法（なし / 定期 / 都度） */
  commuteType: text("commute_type", { enum: COMMUTE_TYPES }).default("none").notNull(),
  /** 通勤経路（例：○○駅⇔△△駅） */
  commuteRoute: text("commute_route").default("").notNull(),
  /** 都度の人の片道運賃（円）。勤怠入力時に往復分を初期値にする */
  commuteOneWayFare: integer("commute_one_way_fare").default(0).notNull(),
  /** 定期の人の月額（円）。毎月の勤務報告書にこの金額を載せる */
  commutePassMonthly: integer("commute_pass_monthly").default(0).notNull(),
  ...timestamps,
})

/** 勤怠（1従業員 × 1日 = 1件） */
export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    /** YYYY-MM-DD */
    workDate: text("work_date").notNull(),
    /** HH:MM */
    startTime: text("start_time").notNull(),
    /** HH:MM */
    endTime: text("end_time").notNull(),
    breakMinutes: integer("break_minutes").default(0).notNull(),
    overtimeMinutes: integer("overtime_minutes").default(0).notNull(),
    note: text("note").default("").notNull(),
    /** その日の通勤費（円）。都度の人のみ使用 */
    commuteFare: integer("commute_fare").default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("attendance_employee_date_uq").on(t.employeeId, t.workDate),
    index("attendance_work_date_idx").on(t.workDate),
  ],
)

export type Employee = typeof employees.$inferSelect
export type AttendanceRecord = typeof attendanceRecords.$inferSelect

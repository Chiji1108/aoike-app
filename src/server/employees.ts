import { createServerFn } from "@tanstack/react-start"
import { asc, desc, eq, max } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { COMMUTE_TYPES, attendanceRecords, employees } from "@/db/kintai-schema"
import { authMiddleware } from "./middleware"

const nameSchema = z
  .string()
  .trim()
  .min(1, "氏名を入力してください")
  .max(50, "氏名は50文字以内で入力してください")

const yen = z.number().int().min(0).max(1_000_000, "金額が大きすぎます")

const commuteSchema = z.object({
  commuteType: z.enum(COMMUTE_TYPES),
  commuteRoute: z.string().trim().max(100, "経路は100文字以内で入力してください"),
  // 往復（×2）が勤怠の通勤費の上限（100,000円）に収まるように
  commuteOneWayFare: yen.max(50_000, "片道の運賃が大きすぎます"),
  commutePassMonthly: yen,
})

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getDb()
    return db
      .select({
        id: employees.id,
        name: employees.name,
        active: employees.active,
        sortOrder: employees.sortOrder,
        commuteType: employees.commuteType,
        commuteRoute: employees.commuteRoute,
        commuteOneWayFare: employees.commuteOneWayFare,
        commutePassMonthly: employees.commutePassMonthly,
      })
      .from(employees)
      .orderBy(desc(employees.active), asc(employees.sortOrder), asc(employees.createdAt))
  })

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: nameSchema, ...commuteSchema.partial().shape }))
  .handler(async ({ data }) => {
    const db = getDb()
    const [row] = await db.select({ value: max(employees.sortOrder) }).from(employees)
    const [created] = await db
      .insert(employees)
      .values({ ...data, sortOrder: (row?.value ?? 0) + 1 })
      .returning({ id: employees.id })
    return created!
  })

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      name: nameSchema.optional(),
      active: z.boolean().optional(),
      ...commuteSchema.partial().shape,
    }),
  )
  .handler(async ({ data }) => {
    const { id, ...values } = data
    await getDb().update(employees).set(values).where(eq(employees.id, id))
    return { ok: true }
  })

/** 勤怠データがない従業員のみ完全に削除できる（ある場合は無効化を案内） */
export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const db = getDb()
    const [used] = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.employeeId, data.id))
      .limit(1)
    if (used) throw new Error("勤怠データがあるため削除できません。「無効にする」をご利用ください。")
    await db.delete(employees).where(eq(employees.id, data.id))
    return { ok: true }
  })

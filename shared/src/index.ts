import { z } from "zod";

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "birthdate must be YYYY-MM-DD")
  .refine(
    (s) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return (
        dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
      );
    },
    { message: "birthdate must be a real calendar date" },
  )
  .refine(
    (s) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(`${s}T00:00:00`).getTime() <= today.getTime();
    },
    { message: "birthdate cannot be in the future" },
  );

export const WeightUnitSchema = z.enum(["lb", "kg"]);
export type WeightUnit = z.infer<typeof WeightUnitSchema>;

export const BabyInputSchema = z.object({
  name: z.string().min(1, "name required").max(60, "name too long"),
  birthdate: isoDateString,
  weightValue: z
    .number()
    .finite("weightValue must be a finite number")
    .positive("weightValue must be positive")
    .lt(1000, "weightValue must be under 1000"),
  weightUnit: WeightUnitSchema,
});

export const BabySchema = BabyInputSchema.extend({
  name: BabyInputSchema.shape.name
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "name required")),
});

export type BabyInput = z.input<typeof BabyInputSchema>;
export type Baby = z.infer<typeof BabySchema>;

export const RecordMetaSchema = z
  .object({
    volume_oz: z.number().optional(),
    side: z.enum(["left", "right", "both", "bottle"]).optional(),
    mins: z.number().optional(),
    where: z.string().nullable().optional(),
    kind: z.enum(["wet", "dirty", "both", "fussy", "happy"]).optional(),
    name: z.string().optional(),
    dose: z.string().optional(),
  })
  .passthrough();

export type RecordMeta = z.infer<typeof RecordMetaSchema>;

export const RoutineRecordInputSchema = z.object({
  type: z.string().min(1, "type required"),
  at: z.string().datetime({ message: "at must be an ISO 8601 datetime" }),
  title: z.string(),
  detail: z.string(),
  meta: RecordMetaSchema,
});

export const RoutineRecordSchema = RoutineRecordInputSchema.extend({
  id: z.number().int(),
});

export type RoutineRecordInput = z.infer<typeof RoutineRecordInputSchema>;
export type RoutineRecord = z.infer<typeof RoutineRecordSchema>;

export const ChatMessageSchema = z.object({
  id: z.number().int(),
  from: z.enum(["user", "bot"]),
  at: z.string().datetime({ message: "at must be an ISO 8601 datetime" }),
  text: z.string(),
  recordIds: z.array(z.number().int()),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  text: z.string().min(1, "text required"),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ParseResultSchema = z.object({
  replyText: z.string(),
  created: z.array(RoutineRecordSchema),
  updated: z.array(RoutineRecordSchema),
  deleted: z.array(z.number().int()),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

export const MAX_CHAT_TEXT_LENGTH = 4_000;
export const MAX_BULK_DELETE_IDS = 500;
export const MAX_TIMEZONE_OFFSET_MIN = 14 * 60;
export const MAX_INTEGER_TEXT_LENGTH = String(Number.MAX_SAFE_INTEGER).length;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTimezoneOffset = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  Math.abs(value) <= MAX_TIMEZONE_OFFSET_MIN;

export interface ChatRequest {
  text: string;
  tzOffsetMin: number | null;
  requestId: string | null;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function validateChatRequest(
  input: unknown,
): ValidationResult<ChatRequest> {
  if (!isObject(input)) return { ok: false };

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > MAX_CHAT_TEXT_LENGTH) return { ok: false };

  const offset = input.tzOffsetMin;
  if (offset !== undefined && !isTimezoneOffset(offset)) return { ok: false };
  const requestId = input.requestId;
  if (
    requestId !== undefined &&
    (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId))
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      text,
      tzOffsetMin: offset === undefined ? null : offset,
      requestId: requestId === undefined ? null : requestId,
    },
  };
}

export interface BriefRequest {
  localDate: string;
  tzOffsetMin: number;
  timeZone: string | null;
}

function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function validateBriefRequest(
  input: unknown,
): ValidationResult<BriefRequest> {
  if (
    !isObject(input) ||
    !isCalendarDate(input.localDate) ||
    !isTimezoneOffset(input.tzOffsetMin) ||
    (input.timeZone !== undefined && !isIanaTimezone(input.timeZone))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      localDate: input.localDate,
      tzOffsetMin: input.tzOffsetMin,
      timeZone: input.timeZone === undefined ? null : input.timeZone,
    },
  };
}

export function parseRecordId(value: string): number | null {
  if (value.length > MAX_INTEGER_TEXT_LENGTH || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseSyncCursor(
  value: string | undefined,
): number | null | false {
  if (value === undefined) return null;
  if (
    value.length > MAX_INTEGER_TEXT_LENGTH ||
    !/^(0|[1-9]\d*)$/.test(value)
  ) {
    return false;
  }
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : false;
}

export function validateBulkDeleteRequest(
  input: unknown,
): ValidationResult<number[]> {
  if (!isObject(input) || !Array.isArray(input.ids)) return { ok: false };
  if (input.ids.length === 0 || input.ids.length > MAX_BULK_DELETE_IDS) {
    return { ok: false };
  }
  if (
    !input.ids.every(
      (id): id is number =>
        typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    )
  ) {
    return { ok: false };
  }
  return { ok: true, value: [...new Set(input.ids)] };
}

export interface CanonicalSerializerOptions {
  stripVolatileFields?: boolean
  normalizeWhitespace?: boolean
}

const VOLATILE_FIELD_NAMES = new Set([
  "created_at",
  "updated_at",
  "expires_at",
  "timestamp",
  "ts",
  "time",
  "now",
  "date",
  "request_id",
  "trace_id",
  "span_id",
  "run_id",
  "uuid",
  "idempotency_key",
  "nonce",
  "_debug",
  "elapsed_ms",
  "duration_ms"
])

const DEFAULT_OPTIONS: Required<CanonicalSerializerOptions> = {
  stripVolatileFields: true,
  normalizeWhitespace: true
}

const ISO_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g
const UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g
const REQUEST_ID_PATTERN = /\b(?:req|request|trace|span|run)_[A-Za-z0-9_-]{8,}\b/g

export function stableStringify(value: unknown, options: CanonicalSerializerOptions = {}): string {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options }

  return stringifyCanonical(value, resolvedOptions)
}

function stringifyCanonical(value: unknown, options: Required<CanonicalSerializerOptions>): string {
  if (typeof value === "string") {
    return JSON.stringify(options.normalizeWhitespace ? normalizeText(value) : value)
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      return JSON.stringify(Number(value.toFixed(6)))
    }

    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item, options)).join(",")}]`
  }

  const objectValue = value as Record<string, unknown>
  const keys = Object.keys(objectValue)
    .filter((key) => !options.stripVolatileFields || !VOLATILE_FIELD_NAMES.has(toSnakeCase(key).toLowerCase()))
    .sort()

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyCanonical(objectValue[key], options)}`).join(",")}}`
}

function normalizeText(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_PATTERN, "<timestamp>")
    .replace(UUID_PATTERN, "<uuid>")
    .replace(REQUEST_ID_PATTERN, "<request_id>")
    .replace(/\s+/g, " ")
    .trim()
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)
}

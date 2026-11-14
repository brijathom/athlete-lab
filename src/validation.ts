import { validDate } from './domain'

export class BackupError extends Error {}
export type RecordValue = Record<string, unknown>
export const fail = (path: string, reason: string): never => { throw new BackupError(`${path}: ${reason}`) }
export function object(value: unknown, path: string, required: string[], optional: string[] = []): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'expected an object.')
  const record = value as RecordValue
  for (const key of required) if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, 'is missing. Choose a complete exported backup.')
  for (const key of Object.keys(record)) if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, 'is not supported by this app version.')
  return record
}
export function text(value: unknown, path: string, max: number, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(path, `expected ${required ? 'non-empty ' : ''}text up to ${max} characters.`)
}
export function number(value: unknown, path: string, min: number, max: number, integer = true): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `expected ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`)
}
export function boolean(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path, 'expected true or false.') }
export function choice(value: unknown, path: string, choices: readonly string[]) { if (typeof value !== 'string' || !choices.includes(value)) fail(path, 'contains an unsupported choice.') }
export function date(value: unknown, path: string) { if (typeof value !== 'string' || !validDate(value)) fail(path, 'expected a valid YYYY-MM-DD date.') }
export function timestamp(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(path, 'expected a valid UTC export/save timestamp.')
}
export function list(value: unknown, path: string, max = 100000): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path, `expected a list with at most ${max} records.`)
  return value
}
export const id = (value: unknown, path: string) => text(value, path, 200, true)
export function records(value: unknown, path: string, validate: (value: unknown, path: string) => void, max?: number, key = 'id') {
  const items = list(value, path, max), ids = new Set<unknown>()
  items.forEach((item, i) => {
    const itemPath = `${path}[${i + 1}]`
    validate(item, itemPath)
    const identifier = (item as RecordValue)[key]
    if (ids.has(identifier)) fail(itemPath, `duplicate ${key}.`)
    ids.add(identifier)
  })
  return items as RecordValue[]
}

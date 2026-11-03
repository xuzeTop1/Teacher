import type { CloudPrivacyConfig } from "../../types/cloudPrivacy"
import { isLocalProvider } from "../../types/cloudPrivacy"

export const AUTHORIZATION_EPOCH_STORAGE_KEY = "teacher-agent-authorization-reduced-at"
const CONTEXT_PERMISSIONS = [
  "sendStudentProfileToCloud", "sendSessionMemoryToCloud", "sendPrivateDocumentContextToCloud"
] as const
// Retain the barrier in this runtime even if browser storage cannot be written.
const volatileEpochs = new WeakMap<Storage, number>()
let unavailableStorageEpoch: number | null = null

export function getAuthorizationReducedAt(): number | null {
  try {
    const raw = localStorage.getItem(AUTHORIZATION_EPOCH_STORAGE_KEY)
    const stored = raw === null ? null : Number(raw)
    const epoch = stored === null || (Number.isFinite(stored) && stored >= 0) ? stored : Infinity
    const pending = volatileEpochs.get(localStorage)
    return pending === undefined ? epoch : Math.max(epoch ?? 0, pending)
  } catch {
    return unavailableStorageEpoch
  }
}

export function recordAuthorizationReduction(before: CloudPrivacyConfig, after: CloudPrivacyConfig): void {
  if (!CONTEXT_PERMISSIONS.some(key => before[key] === true && after[key] !== true)) return
  const at = Math.max(Date.now(), (getAuthorizationReducedAt() ?? 0) + 1)
  try {
    localStorage.setItem(AUTHORIZATION_EPOCH_STORAGE_KEY, String(at))
  } catch {
    try { volatileEpochs.set(localStorage, at) } catch { unavailableStorageEpoch = at }
  }
}

/** Resolve millisecond ties in creation order: newly composed messages follow the barrier. */
export function createProviderMessageTimestamp(): string {
  const epoch = getAuthorizationReducedAt()
  return new Date(Math.max(Date.now(), Number.isFinite(epoch) ? (epoch ?? 0) + 1 : 0)).toISOString()
}

/** Only for outbound copies; never mutate stored messages or the UI history.
 * Unknown timestamps are withheld after a reduction. Local classification is unchanged.
 */
export function filterProviderHistory<T extends { createdAt?: string }>(messages: T[], isLocal?: boolean): T[] {
  const epoch = getAuthorizationReducedAt()
  if (isLocalProvider(isLocal) || epoch === null) return messages
  return messages.filter(message => {
    const at = message.createdAt === undefined ? NaN : Date.parse(message.createdAt)
    return Number.isFinite(at) && at > epoch
  })
}

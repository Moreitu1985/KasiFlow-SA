import { readStorage, writeStorage } from './storage'

const KEY = 'kasiflow.activeBusinessId'

/**
 * Module-level holder so the API client can read the active business without React.
 * The BusinessProvider is the only writer.
 */
let activeBusinessId: string | null = readStorage(KEY)

export function getActiveBusinessId(): string | null {
  return activeBusinessId
}

export function setActiveBusinessId(id: string | null): void {
  activeBusinessId = id
  writeStorage(KEY, id)
}

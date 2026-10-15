/** Native window material. The Windows-only product always renders an opaque frame. */
import type { DesktopPreferences } from './desktop-contract.ts'

/**
 * Material one Next window uses.
 * @param _preferences - Stored desktop preferences. Older files still carry the retired macOS and
 * Linux material keys; they stay readable but never select a material here.
 * @returns The opaque frame every Windows window renders.
 */
export function windowMaterial(_preferences: DesktopPreferences): 'off' {
  return 'off'
}

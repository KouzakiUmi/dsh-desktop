/** Verify the final Electron executable carries every fuse the packaged application requires. */

import {
  FuseV1Options,
  getCurrentFuseWire,
  type FuseConfig,
} from '@electron/fuses'
import { FuseState } from '@electron/fuses/dist/constants.js'

/** Injectable official fuse reader used by focused tests. */
export type ElectronFuseReader = (executable: string) => Promise<FuseConfig<FuseState>>

const REQUIRED_ELECTRON_FUSES = [
  { option: FuseV1Options.RunAsNode, name: 'RunAsNode' },
  {
    option: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    name: 'EnableEmbeddedAsarIntegrityValidation',
  },
] as const

const ASAR_ONLY_ELECTRON_FUSE = {
  option: FuseV1Options.OnlyLoadAppFromAsar,
  name: 'OnlyLoadAppFromAsar',
} as const

function fuseStateName(state: FuseState | undefined): string {
  return state === undefined ? 'MISSING' : (FuseState[state] ?? String(state))
}

/** Fail when the final Windows executable does not carry every required fuse. */
export async function verifyElectronExecutableFuses(
  executable: string,
  read: ElectronFuseReader = getCurrentFuseWire,
  requiresAsar = true,
): Promise<void> {
  let wire: FuseConfig<FuseState>
  try {
    wire = await read(executable)
  } catch (cause) {
    throw new Error(`dsh-desktop-next: failed to inspect Electron fuses at ${executable}`, {
      cause,
    })
  }
  const requiredFuses = [...REQUIRED_ELECTRON_FUSES, ASAR_ONLY_ELECTRON_FUSE]
  const invalid = requiredFuses.flatMap(({ option, name }) => {
    const state = wire[option]
    const expected = option === FuseV1Options.RunAsNode || requiresAsar
      ? FuseState.ENABLE : FuseState.DISABLE
    return state === expected ? [] : [`${name}=${fuseStateName(state)}`]
  })
  if (invalid.length > 0) {
    throw new Error(
      `dsh-desktop-next: final Electron executable at ${executable} has invalid required fuses: ${invalid.join(', ')}`,
    )
  }
}

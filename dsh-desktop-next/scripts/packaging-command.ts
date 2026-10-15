import { spawnSync } from 'node:child_process'

/**
 * Run one packaging command in the workspace. The adopted Windows flow already names this
 * workspace explicitly, so the command is forwarded unchanged.
 * @param command - Executable to run.
 * @param args - Arguments, forwarded verbatim.
 * @param cwd - Working directory.
 * @param env - Environment of the child process.
 */
export function runNextPackagingCommand(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaging command failed (${result.status}): ${command}`)
}

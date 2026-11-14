import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Everything MatrixMixer keeps on the PC lives here. */
export const CONFIG_DIR = process.env.MATRIX_BRIDGE_HOME ?? join(homedir(), '.matrix-bridge');

/** Direct connection details, written by `matrix pair`. */
export type CliConfig = { host?: string; port?: number; token?: string };
/** Written by the desktop app while it runs, so the CLI can hand work to it. */
export type ApiInfo = { port: number; token: string };

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(CONFIG_DIR, name), 'utf8')) as T;
  } catch {
    return null;
  }
}

export const readConfig = (): CliConfig => readJson<CliConfig>('config.json') ?? {};
export const readApiInfo = (): ApiInfo | null => readJson<ApiInfo>('api.json');

export function writeConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}

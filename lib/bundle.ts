import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

export function bundleServer(outputDirectory: string) {
  mkdirSync(outputDirectory, { recursive: true })
  buildSync({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['src/server.ts'],
    outfile: join(outputDirectory, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  })
  writeFileSync(join(outputDirectory, 'package.json'), '{"type":"commonjs"}\n')
}

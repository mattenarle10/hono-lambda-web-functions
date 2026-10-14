import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bundleServer } from '../lib/bundle.js'

const appDirectory = fileURLToPath(new URL('../build/app/', import.meta.url))
const containerDirectory = fileURLToPath(new URL('../build/container/', import.meta.url))
bundleServer(appDirectory)
mkdirSync(containerDirectory, { recursive: true })
for (const name of ['index.js', 'package.json']) {
  copyFileSync(join(appDirectory, name), join(containerDirectory, name))
}
copyFileSync(fileURLToPath(new URL('../Dockerfile', import.meta.url)), join(containerDirectory, 'Dockerfile'))
console.log('Built the local Node.js 24 server')

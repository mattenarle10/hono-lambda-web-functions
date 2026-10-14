import { fileURLToPath } from 'node:url'
import { bundleServer } from '../lib/bundle.js'

bundleServer(fileURLToPath(new URL('../build/app/', import.meta.url)))
console.log('Built the local Node.js 24 server')

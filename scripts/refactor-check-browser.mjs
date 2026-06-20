import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const server = await createServer({
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
  },
})

const run = (script, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${script} exited ${code}`))
    })
  })

try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('Vite did not expose a local dev-server URL')
  console.log(`refactor browser gate using ${baseUrl}`)
  await run('scripts/qa-refactor-contract.mjs', [baseUrl])
  await run('scripts/qa-error.mjs', [baseUrl])
} finally {
  await server.close()
}

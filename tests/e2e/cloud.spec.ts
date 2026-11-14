import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// WebKit service-worker requests bypass Playwright's HTTP route mocks after reload.
// Test cloud transport independently; the existing PWA suite verifies SW/offline reloads.
test.use({ serviceWorkers: 'block' })

const cloudURL = 'https://athlete-lab-test.supabase.co'
const owner = '11111111-1111-4111-8111-111111111111'
type RecordRow = { kind: string; id: string; revision: number; payload: unknown }
async function mockCloud(context: BrowserContext) {
  const records = new Map<string, RecordRow>(), counts = { auth: 0, sync: 0, resets: 0, signup: 0 }
  await context.route(`${cloudURL}/**`, async route => {
    const url = new URL(route.request().url()), body = route.request().postDataJSON()
    if (url.pathname === '/auth/v1/token') {
      counts.auth++
      await route.fulfill({ json: { access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh-token', user: { id: owner, email: 'athlete@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } } })
    } else if (url.pathname === '/auth/v1/signup') { counts.signup++; await route.fulfill({ json: { id: owner, email: 'athlete@example.test', identities: [] } }) }
    else if (url.pathname === '/auth/v1/recover') { counts.resets++; await route.fulfill({ json: {} }) }
    else if (url.pathname === '/auth/v1/logout') await route.fulfill({ status: 204 })
    else if (url.pathname === '/rest/v1/rpc/athlete_sync') {
      counts.sync++
      const changes = body.changes as { kind: string; id: string; expected_revision: number; payload: unknown }[]
      const applied = changes.every(c => (records.get(`${c.kind}:${c.id}`)?.revision ?? 0) === c.expected_revision)
      if (applied) for (const c of changes) records.set(`${c.kind}:${c.id}`, { kind: c.kind, id: c.id, payload: c.payload, revision: c.expected_revision + 1 })
      await route.fulfill({ json: { schemaVersion: 1, applied, records: [...records.values()] } })
    } else await route.fulfill({ status: 400, json: { message: `Unexpected mocked request: ${url.pathname}` } })
  })
  return { records, counts }
}
async function profile(page: Page) {
  await page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Account & cloud sync' })).toBeVisible()
}
async function signIn(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill('athlete@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click()
  await expect(page.getByText('Signed in as')).toBeVisible()
}
test('explicit migration, offline edits, retry, conflict review, session persistence and sign-out preserve local data', async ({ page, context }) => {
  test.setTimeout(120000)
  const server = await mockCloud(context)
  await page.goto('/'); await profile(page)
  await page.getByLabel('Your name', { exact: true }).fill('Original local athlete')
  await page.getByRole('button', { name: 'Save profile & goals' }).click()
  await signIn(page)
  expect(server.records.size).toBe(0)
  await expect(page.getByRole('button', { name: 'Upload local records', exact: true })).toBeDisabled()
  await page.getByLabel('I understand and approve linking the selected data to this account.').check()
  await page.getByRole('button', { name: 'Upload local records', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sync now / retry' })).toBeVisible()
  await expect.poll(() => server.records.size).toBeGreaterThan(5)
  await context.setOffline(true)
  await page.getByLabel('Your name', { exact: true }).fill('Offline account athlete')
  await page.getByRole('button', { name: 'Save profile & goals' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile and goals saved' })).toBeVisible()
  expect(await page.evaluate(account => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('athlete-lab', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, get = db.transaction('state').objectStore('state').get(`account:${account}`)
      get.onsuccess = () => { const name = get.result.profile.name; db.close(); resolve(name) }; get.onerror = () => reject(get.error)
    }
  }), owner)).toBe('Offline account athlete')
  const remote = server.records.get('profile:singleton')!
  server.records.set('profile:singleton', { ...remote, revision: remote.revision + 1, payload: { ...(remote.payload as object), name: 'Other device athlete' } })
  await context.setOffline(false)
  await page.reload(); await profile(page)
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Offline account athlete')
  await page.getByRole('button', { name: 'Sync now / retry' }).click()
  // Allow the documented automatic retry if a reconnect exchange is already active.
  await expect(page.getByRole('heading', { name: 'Review conflicting changes' })).toBeVisible({ timeout: 25000 })
  await page.getByLabel('Keep this device’s version', { exact: true }).check()
  await page.getByLabel('I approve applying these choices to this device and synchronising them.').check()
  await page.getByRole('button', { name: 'Apply reviewed choices', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review conflicting changes' })).not.toBeVisible()
  await expect.poll(() => (server.records.get('profile:singleton')!.payload as { name: string }).name).toBe('Offline account athlete')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible()
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Original local athlete')
  await signIn(page)
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Offline account athlete')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('account creation, account recovery and opening an empty cloud have understandable outcomes', async ({ page, context }) => {
  const server = await mockCloud(context)
  await page.goto('/'); await profile(page)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('athlete@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Create my account', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible()
  expect(server.counts.signup).toBe(1)
  await page.getByRole('button', { name: 'Recover account', exact: true }).click()
  await page.getByRole('button', { name: 'Send recovery email', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'If an account exists' })).toBeVisible()
  expect(server.counts.resets).toBe(1)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await signIn(page)
  await page.getByLabel('I understand and approve linking the selected data to this account.').check()
  await page.getByRole('button', { name: 'Open cloud records', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'no cloud data yet' })).toBeVisible()
  expect(server.records.size).toBe(0)
  await expect(page.getByLabel('Sport', { exact: true })).toHaveValue('Gaelic football')
})

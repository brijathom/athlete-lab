import { test, expect } from '@playwright/test'
import { completeBackup } from '../fixtures/backup'
import { toRecords } from '../../src/sync-domain'
import { prepareProposal, type PreparedProposal } from '../../src/coach-proposals'
import { dateKey, uid } from '../../src/domain'

test.use({ serviceWorkers: 'block' })
const owner = '11111111-1111-4111-8111-111111111111', cloud = 'https://athlete-lab-test.supabase.co'
test('coach previews selected data, saves and reopens answers, exports and deletes history without changing training', async ({ page, context }) => {
  const fixture = completeBackup(), base = toRecords(fixture)
  Object.values(base).forEach(row => { row.revision = 1 })
  let turn: Record<string, unknown> | null = null, deleted = false
  const reply = { answer: 'Choose work based on your recorded training and current availability.', facts: ['Your completed workouts are recorded separately from planned sessions.'], interpretations: ['A conservative progression may be appropriate.'], unknowns: ['Current readiness is unknown.'] }
  await context.route(`${cloud}/**`, async route => {
    const request = route.request(), body = request.postDataJSON(), path = new URL(request.url()).pathname
    if (path === '/rest/v1/rpc/athlete_sync') return route.fulfill({ json: { schemaVersion: 1, applied: true, records: Object.values(base) } })
    if (path !== '/functions/v1/coach') return route.fulfill({ status: 400, json: { message: 'Unexpected test request' } })
    if (body.action === 'list') return route.fulfill({ json: { conversations: turn && !deleted ? [{ id: turn.conversation_id, title: turn.question, created_at: turn.created_at }] : [], limits: { hourly: 6, daily: 20 } } })
    if (body.action === 'preview') return route.fulfill({ json: { source: 'Authenticated cloud records', symptoms: body.sharing.symptoms ? 'Left Knee' : 'Excluded', completedWorkouts: fixture.logs.length } })
    if (body.action === 'chat') {
      expect(body.sharing.symptoms).toBe(false); expect(body).not.toHaveProperty('athleteData')
      turn = { request_id: body.requestId, conversation_id: body.requestId, question: body.question, sharing: body.sharing, reply, state: 'completed', model: 'deterministic-test-model', created_at: new Date().toISOString() }
      return route.fulfill({ json: { turn } })
    }
    if (body.action === 'history') return route.fulfill({ json: { turns: deleted ? [] : [turn] } })
    if (body.action === 'export') return route.fulfill({ json: { format: 'athlete-lab-coaching-history', data: [turn] } })
    if (body.action === 'delete') { deleted = true; return route.fulfill({ json: { deleted: true } }) }
    return route.fulfill({ status: 400, json: { error: 'Unexpected operation' } })
  })
  await page.goto('/connection-check.html')
  await page.evaluate(async ({ fixture, base, owner }) => {
    localStorage.setItem('sb-athlete-lab-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user: { id: owner, email: 'coach-test@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {} } }))
    await new Promise<void>((resolve, reject) => { const request = indexedDB.open('athlete-lab', 1); request.onupgradeneeded = () => request.result.createObjectStore('state'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'); store.put(fixture, 'app'); store.put(fixture, `account:${owner}`); store.put({ version: 1, owner, base, pending: [], lastSynced: new Date().toISOString() }, `sync:${owner}`); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) } })
  }, { fixture, base, owner })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Skills and recovery' : 'Main navigation', exact: true })
  await nav.getByRole('button', { name: 'AI Coach', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI Coach', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preview shared context', exact: true }).click()
  await expect(page.getByLabel('Authorised context preview')).toHaveValue(/Excluded/)
  await page.getByLabel('Your coaching question', { exact: true }).fill('Review my last seven days')
  await expect(page.getByRole('button', { name: 'Ask the coach', exact: true })).toBeDisabled()
  await page.getByLabel('I approve sending this question and the selected context to OpenAI.').check()
  await page.getByRole('button', { name: 'Ask the coach', exact: true }).click()
  await expect(page.getByText(reply.answer, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recorded facts', exact: true })).toBeVisible()
  await page.reload(); await nav.getByRole('button', { name: 'AI Coach', exact: true }).click()
  await page.getByText('Conversation history', { exact: true }).click()
  await page.getByRole('button', { name: 'Review my last seven days', exact: true }).click()
  await expect(page.getByText(reply.answer, { exact: true })).toBeVisible()
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export coaching history' }).click(); expect((await download).suggestedFilename()).toContain('coaching')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete conversation Review my last seven days', exact: true }).click()
  await expect(page.getByText('Conversation deleted.', { exact: true })).toBeVisible()
  expect(deleted).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('training proposals require explicit approval, sync into the plan, and rejection leaves training unchanged', async ({ page, context }) => {
  const fixture = completeBackup(), base = toRecords(fixture), proposals = new Map<string, PreparedProposal>()
  Object.values(base).forEach(row => { row.revision = 1 })
  let approvals = 0, rejections = 0, stale = false
  await context.route(`${cloud}/**`, async route => {
    const body = route.request().postDataJSON(), path = new URL(route.request().url()).pathname
    if (path === '/rest/v1/rpc/athlete_sync') return route.fulfill({ json: { schemaVersion: 1, applied: true, records: Object.values(base) } })
    if (path !== '/functions/v1/coach') return route.fulfill({ status: 400, json: {} })
    if (body.action === 'list') return route.fulfill({ json: { conversations: [], limits: { hourly: 6, daily: 20 } } })
    if (body.action === 'propose') {
      const proposal = prepareProposal({ title: body.question, rationale: 'Proposed skills work; no workout completion is inferred.', actions: [{ operation: 'add', targetId: null, session: { title: body.question, date: dateKey(), category: 'Skills', minutes: 20, notes: '', exercises: [{ id: null, name: 'Controlled kick passing', sets: 2, prescription: '10 attempts each foot', rest: '60 sec', notes: '', skill: null }] } }] }, base, dateKey(), 7, false, new Date().toISOString())
      proposals.set(proposal.id, proposal)
      return route.fulfill({ json: { turn: { request_id: body.requestId, conversation_id: body.conversationId ?? body.requestId, question: body.question, sharing: body.sharing, reply: { answer: 'Review the proposed session before approval.', facts: [], interpretations: [], unknowns: ['Readiness unknown'] }, state: 'completed', model: 'mock', created_at: new Date().toISOString() }, proposals: [proposal] } })
    }
    if (body.action === 'decide') {
      const proposal = proposals.get(body.proposalId)!
      if (body.accept && stale) return route.fulfill({ status: 409, json: { error: 'This proposal is stale. Nothing was applied.', code: 'stale_proposal' } })
      if (body.accept) { expect(body.confirmed).toBe(true); approvals++; for (const c of proposal.changes) base[`session:${c.id}`] = { kind: 'session', id: c.id, revision: 1, payload: c.after } }
      else rejections++
      proposal.status = body.accept ? 'approved' : 'rejected'
      return route.fulfill({ json: { status: proposal.status, alreadyDecided: false } })
    }
    return route.fulfill({ status: 400, json: { error: 'Unexpected operation' } })
  })
  await page.goto('/connection-check.html')
  await page.evaluate(async ({ fixture, base, owner }) => {
    localStorage.setItem('sb-athlete-lab-test-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user: { id: owner, email: 'coach-test@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {} } }))
    await new Promise<void>((resolve, reject) => { const req = indexedDB.open('athlete-lab', 1); req.onupgradeneeded = () => req.result.createObjectStore('state'); req.onerror = () => reject(req.error); req.onsuccess = () => { const db = req.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'); store.put(fixture, 'app'); store.put(fixture, `account:${owner}`); store.put({ version: 1, owner, base, pending: [], lastSynced: new Date().toISOString() }, `sync:${owner}`); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) } })
  }, { fixture, base, owner })
  await page.goto('/')
  const modules = page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Skills and recovery' : 'Main navigation', exact: true })
  await modules.getByRole('button', { name: 'AI Coach', exact: true }).click()
  await page.getByLabel('Request a structured training proposal (requires separate approval)').check()
  await page.getByLabel('Your coaching question', { exact: true }).fill('AI approved skills plan')
  await page.getByLabel('I approve sending this question and the selected context to OpenAI.').check()
  await page.getByRole('button', { name: 'Ask the coach', exact: true }).click()
  const card = page.getByRole('article', { name: 'Training proposal: AI approved skills plan', exact: true })
  await expect(card).toBeVisible(); await expect(card.getByRole('button', { name: 'Approve and save changes' })).toBeDisabled()
  expect(approvals).toBe(0); expect(Object.values(base).some(r => (r.payload as { title?: string })?.title === 'AI approved skills plan')).toBe(false)
  await card.getByLabel('I reviewed these changes and approve saving them to my training plan.').check()
  await card.getByRole('button', { name: 'Approve and save changes' }).click()
  await expect(card.getByText('approved', { exact: true })).toBeVisible()
  expect(approvals).toBe(1)
  const navigation = page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Mobile navigation' : 'Main navigation', exact: true })
  await navigation.getByRole('button', { name: 'Programme', exact: true }).click()
  await expect(page.getByText('AI approved skills plan', { exact: true })).toBeVisible()
  await modules.getByRole('button', { name: 'AI Coach', exact: true }).click()
  await page.getByLabel('Request a structured training proposal (requires separate approval)').check()
  await page.getByLabel('Your coaching question', { exact: true }).fill('Stale plan to reject')
  await page.getByLabel('I approve sending this question and the selected context to OpenAI.').check()
  await page.getByRole('button', { name: 'Ask the coach', exact: true }).click()
  const second = page.getByRole('article', { name: 'Training proposal: Stale plan to reject', exact: true })
  await second.getByLabel('I reviewed these changes and approve saving them to my training plan.').check(); stale = true
  await second.getByRole('button', { name: 'Approve and save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('stale')
  expect(approvals).toBe(1)
  await second.getByRole('button', { name: 'Reject proposal' }).click()
  await expect(second.getByText('rejected', { exact: true })).toBeVisible(); expect(rejections).toBe(1)
  expect(Object.values(base).some(r => (r.payload as { title?: string })?.title === 'Stale plan to reject')).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

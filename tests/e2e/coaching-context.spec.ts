import {navigate} from './navigation'
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { completeBackup } from '../fixtures/backup'

async function openCoaching(page: Page) {
  const nav = page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Skills and recovery' : 'Main navigation', exact: true })
  await navigate(page,'Coaching Context')
  await expect(page.getByRole('heading', { name: 'Coaching Context', exact: true })).toBeVisible()
}
test('preview, privacy controls, Unicode question, clipboard and both downloads use the same stored facts', async ({ page }) => {
  test.setTimeout(120000)
  const fixture = completeBackup()
  fixture.logs[0].notes = 'PRIVATE WORKOUT NOTE'; fixture.recoveryEntries[0].notes = 'PRIVATE RECOVERY NOTE'; fixture.recoveryEntries[0].symptoms[0].notes = 'PRIVATE SYMPTOM NOTE'
  await page.goto('/connection-check.html')
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('athlete-lab', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'app'); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  }), fixture)
  await page.goto('/')
  await openCoaching(page)
  await page.getByRole('button', { name: 'Detailed Context', exact: true }).click()
  await page.getByText('Date ranges and sections', { exact: true }).click()
  await page.getByLabel('Recent from', { exact: true }).fill('2025-03-31')
  await page.getByLabel('Recent through', { exact: true }).fill('2025-04-02')
  await page.getByLabel('Upcoming from', { exact: true }).fill('2025-04-02')
  await page.getByLabel('Upcoming through', { exact: true }).fill('2025-04-08')
  await page.getByLabel('Your coaching question (optional)', { exact: true }).fill('Cén fáth? 🏐 Review my week.')
  const preview = page.getByRole('textbox', { name: 'Markdown preview', exact: true })
  let text = await preview.inputValue()
  expect(text).toContain('Historical test workout'); expect(text).toContain('**Full scoring contribution (points):** 7')
  expect(text).not.toContain('PRIVATE '); expect(text).not.toContain('Knee')
  await page.getByLabel('Include injury and symptom history', { exact: true }).check()
  await expect(preview).toHaveValue(/Knee/)
  expect(await preview.inputValue()).not.toContain('PRIVATE SYMPTOM NOTE')
  await page.getByLabel('Include illness information', { exact: true }).check()
  await page.getByLabel('Include other recovery observations and availability', { exact: true }).check()
  await page.getByLabel('Include free-text notes and reflections (may contain health information)', { exact: true }).check()
  await expect(preview).toHaveValue(/PRIVATE RECOVERY NOTE/)
  text = await preview.inputValue()
  for (const [button, format] of [['Download Markdown', 'md'], ['Download JSON', 'json']]) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: button, exact: true }).click()
    const download = await pending, contents = await readFile((await download.path())!, 'utf8')
    expect(download.suggestedFilename()).toContain(`.${format}`)
    if (format === 'md') expect(contents).toBe(text)
    else {
      const document = JSON.parse(contents)
      expect(document.format).toBe('athlete-lab-coaching-context')
      expect(document.coachingQuestion).toContain('Cén fáth? 🏐')
      expect(document.privacy).toMatchObject({ symptoms: true, illness: true, otherRecovery: true, freeTextNotes: true, identity: false })
      expect(contents).not.toContain('sessionId'); expect(contents).not.toContain('Backup test athlete')
    }
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as Window & { copiedContext?: string }).copiedContext = text } } }))
  await page.getByRole('button', { name: 'Copy context', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Context copied')
  expect(await page.evaluate(() => (window as Window & { copiedContext?: string }).copiedContext)).toBe(text)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const nav = page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Mobile navigation' : 'Main navigation', exact: true })
  await navigate(page,'Today')
  await openCoaching(page)
  await expect(page.getByLabel('Include injury and symptom history', { exact: true })).not.toBeChecked()
  await expect(preview).not.toHaveValue(/PRIVATE /)
})

test('offline context works with no results and provides selectable manual copy when clipboard is denied', async ({ page, context }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await context.setOffline(true)
  await page.reload()
  await openCoaching(page)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied') } } }))
  await page.getByRole('button', { name: 'Copy context', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Clipboard access is unavailable')
  await page.getByRole('button', { name: 'Select preview text', exact: true }).click()
  const selection = await page.getByRole('textbox', { name: 'Markdown preview', exact: true }).evaluate((el: HTMLTextAreaElement) => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length, text: el.value }))
  expect(selection.start).toBe(0); expect(selection.end).toBe(selection.length)
  expect(selection.text).toContain('Proposed; no completion log')
  expect(selection.text).toContain('0 completed workout logs')
  expect(selection.text).toContain('Sensitive recovery categories excluded')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click()
  const downloaded = await downloadEvent
  expect(JSON.parse(await readFile((await downloaded.path())!, 'utf8')).sections.find((s: { key: string }) => s.key === 'testing').records).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.setOffline(false)
})

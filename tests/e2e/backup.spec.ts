import { createPerformanceData } from '../../src/performance-domain'
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { AppData } from '../../src/domain'
import { completeBackup, encodeBackup } from '../fixtures/backup'

const navigation = (page: Page) => page.getByRole('navigation', { name: test.info().project.name.startsWith('iPhone') ? 'Mobile navigation' : 'Main navigation', exact: true })
async function openImport(page: Page) {
  await navigation(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await page.getByRole('button', { name: 'Import backup (JSON)' }).click()
  return page.getByRole('dialog', { name: 'Restore a backup' })
}
async function stored(page: Page): Promise<AppData> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('athlete-lab', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, get = db.transaction('state').objectStore('state').get('app')
      get.onsuccess = () => { db.close(); resolve(get.result) }
      get.onerror = () => { db.close(); reject(get.error) }
    }
  }))
}
const file = (contents: string) => ({ name: 'athlete-backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) })
const upload = async (page: Page, contents: string) => page.getByLabel('Choose JSON backup').setInputFiles(file(contents))

test('restore previews all modules, requires confirmation and preserves exact data across reload and export', async ({ page }) => {
  test.setTimeout(90000)
  const fixture = completeBackup()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A little better. Every day.' })).toBeVisible()
  const before = await stored(page), dialog = await openImport(page)
  await upload(page, encodeBackup(fixture))
  await expect(dialog.getByRole('heading', { name: 'Backup preview' })).toBeVisible()
  await expect(dialog.getByRole('row', { name: 'Completed workouts 2 0' })).toBeVisible()
  await expect(dialog.getByRole('row', { name: 'Skills result blocks 1 0' })).toBeVisible()
  await expect(dialog.getByRole('row', { name: 'Illness observations 1 0' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled()
  expect(await stored(page)).toEqual(before)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await dialog.getByLabel('I understand this replaces all data on this device.').check()
  await page.screenshot({ path: test.info().outputPath('backup-preview.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Let’s go, Backup.' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass('dark')
  expect(await stored(page)).toEqual(fixture)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Let’s go, Backup.' })).toBeVisible()
  await navigation(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue(fixture.profile.name)
  await expect(page.getByLabel('Weekly workout target')).toHaveValue('3')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all data (JSON)' }).click()
  const download = await downloaded
  const exportedText = await readFile((await download.path())!, 'utf8')
  const { exportedAt, ...exported } = JSON.parse(exportedText)
  expect(Number.isFinite(Date.parse(exportedAt))).toBe(true)
  expect(exported).toEqual(fixture)
  await openImport(page)
  await upload(page, exportedText)
  await expect(dialog.getByRole('heading', { name: 'Backup preview' })).toBeVisible()
  await expect(dialog.getByRole('row', { name: 'Completed workouts 2 2' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('backup-preview-dark.png') })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await stored(page)).toEqual(fixture)
})

test('invalid and incompatible files never write; changing files resets confirmation and cancel leaves data intact', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  const dialog = await openImport(page), before = await stored(page)
  for (const [contents, message] of [
    ['{bad', 'not valid JSON'],
    [encodeBackup({ ...completeBackup(), version: 99 }), 'only versions 1, 2 and 3'],
    [encodeBackup({ ...completeBackup(), recoveryEntries: undefined }), 'recoveryEntries'],
    [encodeBackup({ ...completeBackup(), activeProgrammeId: 'missing' }), 'included programme'],
  ]) {
    await upload(page, contents)
    await expect(dialog.getByRole('alert')).toContainText(message)
    await expect(dialog.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled()
    expect(await stored(page)).toEqual(before)
  }
  await upload(page, encodeBackup(completeBackup()))
  await dialog.getByLabel('I understand this replaces all data on this device.').check()
  await upload(page, encodeBackup({ ...completeBackup(), theme: 'light' }))
  await expect(dialog.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await stored(page)).toEqual(before)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'A little better. Every day.' })).toBeVisible()
})

test('version 1 exports preview their upgrade and restore history without invented records', async ({ page }) => {
  const { recoveryEntries: _, performance: _performance, ...seed } = completeBackup()
  seed.logs = seed.logs.filter(l => !l.skillResults)
  seed.sessions = seed.sessions.filter(s => s.category !== 'Skills')
  const legacy = { ...seed, version: 1 }
  await page.goto('/')
  const dialog = await openImport(page)
  await upload(page, encodeBackup(legacy))
  await expect(dialog.getByText('This older backup will be upgraded.', { exact: false })).toBeVisible()
  await dialog.getByLabel('I understand this replaces all data on this device.').check()
  await dialog.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await stored(page)).toEqual({ ...legacy, version: 3, recoveryEntries: [], performance: createPerformanceData() })
})

test('an aborted restore keeps the previous data and allows a confirmed retry', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  const dialog = await openImport(page), before = await stored(page), fixture = completeBackup()
  await upload(page, encodeBackup(fixture))
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args)
      request.addEventListener('success', () => request.transaction!.abort(), { once: true })
      IDBObjectStore.prototype.put = original
      return request
    }
  })
  await dialog.getByLabel('I understand this replaces all data on this device.').check()
  await dialog.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Your previous data is still saved')
  expect(await stored(page)).toEqual(before)
  await expect(dialog.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled()
  await dialog.getByLabel('I understand this replaces all data on this device.').check()
  await dialog.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await stored(page)).toEqual(fixture)
})

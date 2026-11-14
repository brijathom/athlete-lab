import { test, expect } from '@playwright/test'

test('failed entry script shows recovery instead of a blank page', async ({ page }) => {
  await page.route('**/assets/index-*.js', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The app could not finish opening' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload app' })).toBeVisible()
  await page.getByText('Connection details', { exact: true }).click()
  await expect(page.locator('#startup-details')).toContainText('An app script could not be downloaded.')
})

test('disabled JavaScript still explains how to open the app', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByText('check that JavaScript is enabled', { exact: false })).toBeVisible()
  await context.close()
})

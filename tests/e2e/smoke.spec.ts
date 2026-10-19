import { expect, test } from '@playwright/test'
import { blockRemoteSuggestions, PASSWORD, randomEmail, torontoParts } from './fixtures'

test('sign up, add a med, take the dose, see stock and history update', async ({ page, context }) => {
  await blockRemoteSuggestions(context)
  // Late in the evening a 23:59 dose is not safely in the future: use tomorrow at noon instead.
  const { hour } = torontoParts()
  const tomorrow = hour >= 23
  const doseTime = tomorrow ? '12:00' : '23:59'

  await page.goto('/')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.getByLabel('Email').fill(randomEmail())
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  await page.getByRole('link', { name: 'Meds' }).click()
  await page.getByRole('button', { name: '+ Add' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Smoke Med')
  await page.getByLabel('Stock', { exact: true }).fill('10')
  await page.getByLabel('Time 1').fill(doseTime)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Smoke Med')).toBeVisible()

  await page.getByRole('link', { name: 'Today' }).click()
  if (tomorrow) {
    const week = page.getByRole('group', { name: 'Week' })
    const today = week.locator('.is-today')
    await today.locator('xpath=following-sibling::button[1]').click()
  }
  await page.getByRole('button', { name: 'Taken Smoke Med' }).click()
  await expect(page.getByText('Resolved (1)')).toBeVisible()

  await page.getByRole('link', { name: 'Meds' }).click()
  await expect(page.getByText('9 pills left')).toBeVisible()

  await page.getByRole('link', { name: 'History' }).click()
  if (!tomorrow) await expect(page.getByRole('img', { name: 'Taken' })).toBeVisible()
})

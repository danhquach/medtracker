import { expect, test } from '@playwright/test'
import { blockRemoteSuggestions, PASSWORD, randomEmail, torontoParts } from './fixtures'

test('guest data survives creating a profile and shows on a second device', async ({ page, context, browser }) => {
  await blockRemoteSuggestions(context)
  const email = randomEmail()

  await page.goto('/')
  await page.getByRole('button', { name: 'Continue without profile' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  await page.getByRole('link', { name: 'Meds' }).click()
  await page.getByRole('button', { name: '+ Add' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Test Med')
  await page.getByLabel('Time 1').fill(torontoParts(1).time)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Test Med')).toBeVisible()

  await page.getByRole('link', { name: 'Today' }).click()
  const banner = page.getByRole('region', { name: 'Guest mode' })
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Create profile' }).click()
  await page.getByRole('button', { name: 'Create profile' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByText(email)).toBeVisible()

  await page.getByRole('link', { name: 'Meds' }).click()
  await expect(page.getByText('Test Med')).toBeVisible()

  const other = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Toronto', locale: 'en-US' })
  try {
    await blockRemoteSuggestions(other)
    const p2 = await other.newPage()
    await p2.goto('/')
    await p2.getByRole('button', { name: 'Sign in' }).click()
    await p2.getByLabel('Email').fill(email)
    await p2.getByLabel('Password').fill(PASSWORD)
    await p2.getByRole('button', { name: 'Sign in' }).click()
    await p2.getByRole('link', { name: 'Meds' }).click()
    await expect(p2.getByText('Test Med')).toBeVisible()
  } finally {
    await other.close()
  }
})

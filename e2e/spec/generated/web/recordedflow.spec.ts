import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://misha-customer-billing.vercel.app/login');
  await page.getByRole('textbox', { name: 'Email Address' }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill('surya@evanek.com');
  await page.getByRole('textbox', { name: 'Email Address' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Email Address' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Email Address' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Email Address' }).press('ArrowLeft');
  await page.getByRole('textbox', { name: 'Email Address' }).fill('surya@evanke.com');
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('Test@123');
  await page.getByRole('button', { name: 'Login' }).click();
});
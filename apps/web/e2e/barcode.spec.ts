import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import { ean13, scan, useMockScanner } from './scanner';

// #65: scan a barcode at a step. The store keeps what earlier runs added, so each run uses a barcode
// of its own.
test('#65-1 to #65-4: an unknown barcode is added once, and the next scan finds the product', async ({
  page,
}, testInfo) => {
  await useMockScanner(page);
  const code = ean13(
    `590${String(Date.now()).slice(-8)}${testInfo.project.name === 'phone' ? '1' : '2'}`,
  );
  const name = `Scanned curd ${code}`;

  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByLabel(en.step.grams).fill('200');

  await page.getByRole('button', { name: en.step.scan }).click();
  const scanView = page.getByRole('dialog', { name: en.scan.title });
  await expect(scanView).toBeVisible();
  // A read that isn't a valid code is skipped: the view stays, nothing is looked up.
  await scan(page, code.slice(0, 12) + String((Number(code[12]) + 1) % 10));
  await expect(scanView).toBeVisible();
  await scan(page, code);

  // Unknown: the product form opens with the barcode, in the step's class.
  const form = page.getByRole('dialog', { name: en.product.title });
  await expect(form.getByText(en.product.barcode.replace('{{barcode}}', code))).toBeVisible();
  await expect(form.getByLabel(en.product.ingredientClass)).toHaveValue('curd');
  await form.getByLabel(en.product.name).fill(name);
  await form.getByLabel(en.product.field.protein).fill('12,5');
  await form.getByRole('button', { name: en.product.save }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('radio', { name })).toBeChecked();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(page.getByLabel(en.step.grams)).toHaveValue('200');

  // Another meal: the same code is found, and selects the product with no form.
  await page.getByRole('button', { name: en.step.discard }).click();
  await page.getByRole('button', { name: en.step.confirmDiscard }).click();
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.step.scan }).click();
  await scan(page, code);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('radio', { name })).toBeChecked();
});

test('#65-1, #65-2: digits typed in are checked, and a UPC-A or EAN-8 is the same barcode padded to 13 digits', async ({
  page,
}) => {
  await useMockScanner(page);
  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.step.scan }).click();
  const scanView = page.getByRole('dialog', { name: en.scan.title });
  const digits = scanView.getByLabel(en.scan.digits);
  await digits.fill('12345');
  await scanView.getByRole('button', { name: en.scan.useDigits }).click();
  await expect(scanView.getByText(en.scan.problem.format)).toBeVisible();
  await digits.fill('036000291453');
  await scanView.getByRole('button', { name: en.scan.useDigits }).click();
  await expect(scanView.getByText(en.scan.problem.checkDigit)).toBeVisible();
  await digits.fill('0360 0029 1452');
  await scanView.getByRole('button', { name: en.scan.useDigits }).click();
  const form = page.getByRole('dialog', { name: en.product.title });
  await expect(
    form.getByText(en.product.barcode.replace('{{barcode}}', '0036000291452')),
  ).toBeVisible();
});

// #66: the stand-in for Open Food Facts (e2e/lookupStub.js) knows two barcodes, one per project, so
// each starts from a product the store hasn't got.
test('#66-1 to #66-5: an unknown barcode is looked up, the form opens filled in, and saving credits Open Food Facts', async ({
  page,
}, testInfo) => {
  await useMockScanner(page);
  // The phone scans an EAN-13; the tablet an EAN-8, which the store keeps as 13 digits.
  const phone = testInfo.project.name === 'phone';
  const scanned = phone ? '3017620422003' : '80177173';
  const stored = phone ? '3017620422003' : '0000080177173';

  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.step.scan }).click();
  await scan(page, scanned);

  const form = page.getByRole('dialog', { name: en.product.title });
  await expect(form.getByLabel(en.product.name)).toHaveValue('Nutella');
  await expect(form.getByLabel(en.product.field.kcal)).toHaveValue('539');
  await expect(form.getByLabel(en.product.field.protein)).toHaveValue('6.3');
  await expect(form.getByText(en.product.barcode.replace('{{barcode}}', stored))).toBeVisible();
  await expect(
    form.getByText(en.product.prefilled.replace('{{source}}', 'Open Food Facts')),
  ).toBeVisible();
  // The class is the step's, not the provider's.
  await expect(form.getByLabel(en.product.ingredientClass)).toHaveValue('curd');
  // Nothing is stored until Save.
  await form.getByRole('button', { name: en.product.save }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Nutella', checked: true })).toBeVisible();
  await expect(
    page.getByText(en.product.credit.replace('{{source}}', 'Open Food Facts')),
  ).toBeVisible();

  // Another meal: the store knows it now, so the scan selects it with no form. (Both products here
  // are called Nutella, as in Open Food Facts: the checked one is the one scanned.)
  await page.getByRole('button', { name: en.step.discard }).click();
  await page.getByRole('button', { name: en.step.confirmDiscard }).click();
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.step.scan }).click();
  await scan(page, scanned);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Nutella', checked: true })).toBeVisible();
});

// #67: Open Food Facts first, then USDA FoodData Central (the stand-ins in e2e/lookupStub.js). The
// stand-in USDA knows one product, so the phone scans it (not in Open Food Facts) and the tablet
// scans a code neither has.
test('#67-1 to #67-4: a barcode Open Food Facts lacks is looked up in USDA FoodData Central, or both give the empty form', async ({
  page,
}, testInfo) => {
  await useMockScanner(page);
  const phone = testInfo.project.name === 'phone';
  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.step.scan }).click();
  // A UPC-A as the camera reads it.
  await scan(page, phone ? '016000275683' : '036000291452');

  const form = page.getByRole('dialog', { name: en.product.title });
  if (!phone) {
    // Neither provider has it: the empty form, with the barcode.
    await expect(form.getByLabel(en.product.name)).toHaveValue('');
    await expect(
      form.getByText(en.product.barcode.replace('{{barcode}}', '0036000291452')),
    ).toBeVisible();
    return;
  }
  await expect(form.getByLabel(en.product.name)).toHaveValue('Frosted Corn Puffs');
  await expect(form.getByLabel(en.product.brand)).toHaveValue('Cocoa Puffs');
  await expect(form.getByLabel(en.product.field.kcal)).toHaveValue('370');
  // USDA has no salt: unknown, never 0.
  await expect(form.getByLabel(en.product.field.salt)).toHaveValue('');
  await expect(
    form.getByText(en.product.prefilled.replace('{{source}}', 'USDA FoodData Central')),
  ).toBeVisible();
  await form.getByLabel(en.product.field.kcal).fill('370');
  await form.getByRole('button', { name: en.product.save }).click();
  // The macros (protein 3.7, fat 5.56, carbs 85.2, fibre 3.7) agree with 370 kcal.
  await expect(form).toBeHidden();
  await expect(
    page.getByRole('radio', { name: 'Frosted Corn Puffs', checked: true }),
  ).toBeVisible();
  await expect(
    page.getByText(en.product.credit.replace('{{source}}', 'USDA FoodData Central')),
  ).toBeVisible();
});

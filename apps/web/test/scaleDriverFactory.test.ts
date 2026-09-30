import type { ScaleDriver } from '@macrofill/scale';
import { MockScaleDriver } from '@macrofill/scale/mock';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_SCALE_KEY, scaleDriverFactory, type MockScaleWindow } from '../src/scale';

const real = { id: 'real' } as unknown as ScaleDriver;

afterEach(() => {
  localStorage.clear();
  delete (window as MockScaleWindow).macrofillScale;
});

describe('scale driver factory', () => {
  it('M6-8: uses the real driver unless the mock scale is switched on', async () => {
    const create = await scaleDriverFactory(() => real);
    expect(create()).toBe(real);
    expect((window as MockScaleWindow).macrofillScale).toBeUndefined();
  });

  it('M6-8: with the flag set, creates MockScaleDriver and exposes it for the test to drive', async () => {
    localStorage.setItem(MOCK_SCALE_KEY, '1');
    const create = await scaleDriverFactory(() => real);
    const driver = create();
    expect(driver).toBeInstanceOf(MockScaleDriver);
    await driver.connect();
    expect((window as MockScaleWindow).macrofillScale).toBe(driver);
    expect((window as MockScaleWindow).macrofillScaleScript).toBeTypeOf('function');
  });

  it('M6-8: exposes the mock the session connects, not a discarded one (regression: #28)', async () => {
    localStorage.setItem(MOCK_SCALE_KEY, '1');
    const create = await scaleDriverFactory(() => real);
    // StrictMode runs the useState initializer twice in development, and keeps one driver.
    const kept = create();
    create();
    await kept.connect();
    expect((window as MockScaleWindow).macrofillScale).toBe(kept);
  });
});

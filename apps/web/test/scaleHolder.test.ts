import { MockScaleDriver } from '@macrofill/scale/mock';
import { describe, expect, it, vi } from 'vitest';
import { ScaleHolder } from '../src/scale';

describe('ScaleHolder', () => {
  it('#89-1: creates the driver on first use, once, and not before', () => {
    const create = vi.fn(() => new MockScaleDriver());
    const holder = new ScaleHolder(create);
    expect(create).not.toHaveBeenCalled();
    expect(holder.connected).toBe(false);
    expect(holder.driver).toBe(holder.driver);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('#89-1, #89-2: knows whether the scale is connected, from the first connect to a drop', async () => {
    const driver = new MockScaleDriver();
    const holder = new ScaleHolder(() => driver);
    expect(holder.driver).toBe(driver);
    expect(holder.connected).toBe(false);
    await driver.connect();
    expect(holder.connected).toBe(true);
    driver.drop();
    expect(holder.connected).toBe(false);
    await driver.connect();
    expect(holder.connected).toBe(true);
  });
});

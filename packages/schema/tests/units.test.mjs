import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromEv, fromMeters, toEv, toMeters } from '../dist/index.js';

test('converts common length units to canonical meters', () => {
  assert.equal(toMeters({ value: 100, unit: 'cm' }), 1);
  assert.equal(toMeters({ value: 1000, unit: 'mm' }), 1);
});

test('converts energy units through eV canonical form', () => {
  assert.equal(toEv({ value: 2, unit: 'MeV' }), 2_000_000);
  assert.deepEqual(fromEv(1_000, 'keV'), { value: 1, unit: 'keV' });
});

test('converts canonical meters back to requested units', () => {
  assert.deepEqual(fromMeters(1, 'cm'), { value: 100, unit: 'cm' });
});

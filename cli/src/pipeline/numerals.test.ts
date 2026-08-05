import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { hasNumeral } from './numerals.js';

test('model wording refuses ASCII and Unicode numerals, but ordinary words remain valid', () => {
  assert.equal(hasNumeral('offer a plan before implementation'), false);
  assert.equal(hasNumeral('offer two options in prose'), false, 'spelled words are wording, not a numeric token');
  assert.equal(hasNumeral('offer 2 options'), true);
  assert.equal(hasNumeral('use ２ options'), true, 'full-width digits do not bypass the boundary');
  assert.equal(hasNumeral('take option ②'), true, 'enclosed numerals do not bypass the boundary');
  assert.equal(hasNumeral('plain first', 'then 3'), true, 'every persisted field participates');
});

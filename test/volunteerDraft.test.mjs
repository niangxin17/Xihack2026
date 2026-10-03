import assert from 'node:assert/strict';
import VD from '../volunteerDraft.js';

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  PASS', name);
}

const base = [
  { id: 'a', school: { name: 'A' } },
  { id: 'b', school: { name: 'B' } },
  { id: 'c', school: { name: 'C' } }
];

console.log('volunteerDraft logic tests:');

check('moveDown swaps adjacent elements', () => {
  assert.deepEqual(VD.moveDown(base, 0).map((x) => x.id), ['b', 'a', 'c']);
});

check('moveUp swaps adjacent elements', () => {
  assert.deepEqual(VD.moveUp(base, 2).map((x) => x.id), ['a', 'c', 'b']);
});

check('moveUp on first element is a no-op', () => {
  assert.deepEqual(VD.moveUp(base, 0).map((x) => x.id), ['a', 'b', 'c']);
});

check('moveDown on last element is a no-op', () => {
  assert.deepEqual(VD.moveDown(base, 2).map((x) => x.id), ['a', 'b', 'c']);
});

check('operations do not mutate the original array', () => {
  const copy = base.slice();
  VD.moveDown(base, 0);
  VD.moveUp(base, 2);
  assert.deepEqual(base, copy);
});

check('withSequence derives 1-based seq only (no school field added)', () => {
  const r = VD.withSequence(base);
  assert.equal(r.length, 3);
  assert.equal(r[0].seq, 1);
  assert.equal(r[2].seq, 3);
  assert.equal(r[0].draft.school.name, 'A');
  assert.equal(Object.keys(r[0].draft.school).length, 1); // 学校对象字段未被修改
});

check('handles empty array without throwing', () => {
  assert.deepEqual(VD.moveUp([], 0), []);
  assert.deepEqual(VD.moveDown([], 0), []);
  assert.deepEqual(VD.withSequence([]), []);
});

check('no quantity cap: 50-item array reorders correctly', () => {
  const big = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }));
  const r = VD.moveDown(big, 49); // 末元素 -> 原样
  assert.equal(r.length, 50);
  const r2 = VD.moveDown(big, 0);
  assert.equal(r2.length, 50);
  assert.equal(r2[1].id, '0');
});

console.log('\nAll ' + pass + ' logic tests passed.');

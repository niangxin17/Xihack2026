import assert from 'node:assert/strict';
import Store from '../js/store.js';

let pass = 0;
function check(n, f) { f(); pass++; console.log('  PASS', n); }

check('add then getDrafts returns persisted item', () => {
  Store.clear();
  Store.add({ id: 's1', name: 'A', refScore: 600 });
  const d = Store.getDrafts();
  assert.equal(d.length, 1);
  assert.equal(d[0].id, 's1');
});

check('add is idempotent (no duplicate)', () => {
  Store.add({ id: 's1', name: 'A', refScore: 600 });
  assert.equal(Store.getDrafts().length, 1);
});

check('toggle removes when present', () => {
  Store.toggle({ id: 's1', name: 'A', refScore: 600 });
  assert.equal(Store.has('s1'), false);
  assert.equal(Store.getDrafts().length, 0);
});

check('moveUpById/moveDownById reorder by id', () => {
  Store.clear();
  Store.add({ id: 'a', name: 'A', refScore: 1 });
  Store.add({ id: 'b', name: 'B', refScore: 2 });
  Store.add({ id: 'c', name: 'C', refScore: 3 });
  assert.deepEqual(Store.moveDownById('a').map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(Store.moveUpById('c').map((x) => x.id), ['b', 'c', 'a']);
});

check('moveUp at top / moveDown at bottom are no-ops', () => {
  Store.clear();
  Store.add({ id: 'a', name: 'A' });
  Store.add({ id: 'b', name: 'B' });
  assert.deepEqual(Store.moveUpById('a').map((x) => x.id), ['a', 'b']);
  assert.deepEqual(Store.moveDownById('b').map((x) => x.id), ['a', 'b']);
});

check('withSequence derives 1-based seq without mutating draft', () => {
  Store.clear();
  Store.add({ id: 'a', name: 'A', refScore: 1 });
  Store.add({ id: 'b', name: 'B', refScore: 2 });
  Store.add({ id: 'c', name: 'C', refScore: 3 });
  const d = Store.getDrafts();
  const s = Store.withSequence(d);
  assert.equal(s[0].seq, 1);
  assert.equal(s[s.length - 1].seq, d.length);
  assert.equal(Object.keys(s[0].draft).length, 3); // 仅 id/name/refScore
});

check('no extra school fields persisted', () => {
  Store.clear();
  Store.add({ id: 'x', name: 'X', refScore: 99, extra: 'drop-me' });
  const d = Store.getDrafts()[0];
  assert.equal(d.extra, undefined);
  assert.equal(d.name, 'X');
});

check('count reflects drafts', () => {
  Store.clear();
  assert.equal(Store.count(), 0);
  Store.add({ id: 'z', name: 'Z' });
  assert.equal(Store.count(), 1);
});

console.log('\nAll ' + pass + ' store tests passed.');

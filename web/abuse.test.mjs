import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbuseGuard, networkKey, AbuseLimit } from './abuse.mjs';

test('IP quotas survive rotated tab identities and failed model requests', () => {
  const guard=createAbuseGuard({startsPerHour:2});
  guard.acquire('192.0.2.1',{start:true})();
  guard.acquire('192.0.2.1',{start:true})();
  assert.throws(()=>guard.acquire('192.0.2.1',{start:true}),AbuseLimit);
  guard.acquire('192.0.2.2',{start:true})();
});
test('start and all-model-call budgets are separate and have a shared ceiling', () => {
  const guard=createAbuseGuard({writesPerHour:2,globalWritesPerHour:3,globalStartsPerHour:2});
  guard.acquire('192.0.2.1',{start:true})();
  guard.acquire('192.0.2.1')();
  assert.throws(()=>guard.acquire('192.0.2.1'),AbuseLimit);
  guard.acquire('192.0.2.2',{start:true})();
  assert.throws(()=>guard.acquire('192.0.2.3'),AbuseLimit);
});
test('global start cap cannot be bypassed using different networks', () => {
  const guard=createAbuseGuard({globalStartsPerHour:1});
  guard.acquire('192.0.2.1',{start:true})();
  assert.throws(()=>guard.acquire('192.0.2.2',{start:true}),AbuseLimit);
  guard.acquire('192.0.2.2')(); // existing sessions can still finish
});
test('concurrent work is bounded and release is idempotent', () => {
  const guard=createAbuseGuard({maxConcurrent:2,perIPConcurrent:1});
  const release=guard.acquire('192.0.2.1');
  assert.throws(()=>guard.acquire('192.0.2.1'),AbuseLimit);
  const release2=guard.acquire('192.0.2.2');
  assert.throws(()=>guard.acquire('192.0.2.3'),AbuseLimit);
  release();release();
  const release3=guard.acquire('192.0.2.3');
  assert.throws(()=>guard.acquire('192.0.2.4'),AbuseLimit);
  release2();release3();
});
test('sliding hour expires correctly and network storage is bounded', () => {
  let time=1000;
  const guard=createAbuseGuard({now:()=>time,startsPerHour:1,maxNetworks:1});
  guard.acquire('192.0.2.1',{start:true})();
  assert.throws(()=>guard.acquire('192.0.2.2'),AbuseLimit);
  time+=3599000;
  assert.throws(()=>guard.acquire('192.0.2.1',{start:true}),e=>e.retryAfterSec===1);
  time+=61000;
  guard.acquire('192.0.2.2',{start:true})();
});
test('IPv4 and mapped addresses share a key; IPv6 privacy rotation shares /64', () => {
  assert.equal(networkKey('::ffff:192.0.2.1'),networkKey('192.0.2.1'));
  assert.equal(networkKey('2001:db8:1:2::1'),networkKey('2001:0db8:0001:0002:ffff:123:456:789'));
  assert.notEqual(networkKey('2001:db8:1:2::1'),networkKey('2001:db8:1:3::1'));
  assert.equal(networkKey('invalid'),'unknown');
});

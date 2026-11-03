import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RoomEventAdapter } from '../integrations/room/event-adapter.ts';

function fixture(t, scriptBody, instanceId = 'fixture-writer-instance') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-room-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, 'room-events.jsonl');
  const script = path.join(root, 'send-fixture.mjs');
  fs.writeFileSync(script, scriptBody, 'utf8');
  return {
    ledger,
    adapter: new RoomEventAdapter({
      eventsLedgerPath: ledger,
      commsScriptPath: script,
      instanceId: instanceId ?? undefined,
    }),
  };
}

const requiredEvent = {
  taskId: 'CMD-ROOM-TEST-1',
  sender: 'codex',
  summary: 'Required Room delivery fixture',
  broadcastToRoom: true,
  requiredRoomDelivery: true,
};

test('required Room failure leaves no typed event that could be mistaken for reported activity', async (t) => {
  const { ledger, adapter } = fixture(t, "process.stderr.write('delivery refused'); process.exitCode = 1;\n");

  await assert.rejects(adapter.emitEvent('TASK_ASSIGNED', requiredEvent), /Required Room delivery failed/);
  assert.equal(fs.existsSync(ledger), false);
  assert.equal(adapter.readEvents().state, 'UNAVAILABLE');
});

test('required Room success persists the broker sequence in the typed side-ledger', async (t) => {
  const { ledger, adapter } = fixture(t, "process.stdout.write('Room Record #42 posted\\n');\n");

  const event = await adapter.emitEvent('TASK_ASSIGNED', requiredEvent);
  assert.deepEqual(event.room_ref, { sequence: 42, status: 'POSTED' });
  const read = adapter.readEvents({ taskId: requiredEvent.taskId });
  assert.equal(read.ok, true);
  assert.equal(read.events.length, 1);
  assert.deepEqual(read.events[0].room_ref, { sequence: 42, status: 'POSTED' });
  assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 1);
});

test('a Room sequence remains authoritative when send.mjs exits after confirming the append', async (t) => {
  const { adapter } = fixture(t, "process.stdout.write('Room Record #43 posted\\n'); process.exitCode = 1;\n");

  const event = await adapter.emitEvent('TASK_ASSIGNED', requiredEvent);
  assert.deepEqual(event.room_ref, { sequence: 43, status: 'POSTED' });
  assert.equal(adapter.readEvents({ taskId: requiredEvent.taskId }).events.length, 1);
});

test('local side-ledger failure exposes the already-confirmed Room sequence for reconciliation', async (t) => {
  const { ledger, adapter } = fixture(t, "process.stdout.write('Room Record #44 posted\\n');\n");
  fs.mkdirSync(ledger);

  await assert.rejects(
    adapter.emitEvent('TASK_ASSIGNED', requiredEvent),
    /Room record #44 was confirmed, but typed side-ledger persistence failed/,
  );
});

test('optional failed Room delivery is persisted with an explicit UNCONFIRMED reference', async (t) => {
  const { adapter } = fixture(t, "process.stderr.write('delivery unavailable'); process.exitCode = 1;\n");

  const event = await adapter.emitEvent('TASK_CREATED', {
    taskId: 'CMD-ROOM-TEST-2',
    sender: 'codex',
    summary: 'Optional Room delivery fixture',
    broadcastToRoom: true,
  });
  assert.equal(event.room_ref.status, 'UNCONFIRMED');
  const read = adapter.readEvents({ taskId: 'CMD-ROOM-TEST-2' });
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].room_ref.status, 'UNCONFIRMED');
});

test('optional Room delivery without a stable writer instance is not attempted', async (t) => {
  const { adapter } = fixture(t, "process.stdout.write('Room Record #45 posted\\n');\n", null);

  const event = await adapter.emitEvent('TASK_CREATED', {
    taskId: 'CMD-ROOM-TEST-3',
    sender: 'codex',
    summary: 'Unbound writer fixture',
    broadcastToRoom: true,
  });

  assert.deepEqual(event.room_ref, {
    status: 'UNCONFIRMED',
    reason: 'No stable Room writer instance is configured.',
  });
  assert.equal(adapter.readEvents({ taskId: 'CMD-ROOM-TEST-3' }).events.length, 1);
});

test('requiredRoomDelivery refuses a local-only event', async (t) => {
  const { ledger, adapter } = fixture(t, "process.stdout.write('unused');\n");

  await assert.rejects(adapter.emitEvent('TASK_ASSIGNED', {
    ...requiredEvent,
    broadcastToRoom: false,
  }), /must enable broadcastToRoom/);
  assert.equal(fs.existsSync(ledger), false);
});

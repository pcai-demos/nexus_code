import { test } from "node:test";
import assert from "node:assert/strict";
import { emitAudit, AuditEvent, AuditStore } from "../src/audit-log";

function memoryStore(): AuditStore & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, append: async (event) => void events.push(event) };
}

const fixedNow = () => new Date("2026-05-11T10:15:00Z");

test("an audit event is stored with its time", async () => {
  const store = memoryStore();
  const event = await emitAudit(
    store,
    { action: "CAPTURE_POSTED", actor: "job:capture-poster", subject: "payment:PAY-77120", before: null, after: { status: "POSTED" }, reference: "CHG-2026-0311" },
    fixedNow,
  );
  assert.equal(store.events.length, 1);
  assert.equal(event.at, "2026-05-11T10:15:00.000Z");
  assert.deepEqual(store.events[0], event);
});

test("an audit event without a reference is refused", async () => {
  const store = memoryStore();
  await assert.rejects(
    emitAudit(store, { action: "SETTLEMENT_HELD", actor: "job:reconciler", subject: "settlement:2026-05-10", before: null, after: { held: true }, reference: "" }, fixedNow),
    /needs an actor, a subject and a reference/,
  );
  assert.equal(store.events.length, 0);
});

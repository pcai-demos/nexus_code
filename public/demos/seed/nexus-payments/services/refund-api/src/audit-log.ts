/**
 * Audit events for money movement (PAY-030): who or which job acted, on what, when, the values before and after,
 * and the ticket or change reference. Events go to the audit store; application code never edits or deletes them.
 */
export type AuditAction = "CAPTURE_POSTED" | "SETTLEMENT_HELD" | "SETTLEMENT_RELEASED";

export interface AuditEvent {
  action: AuditAction;
  actor: string;
  subject: string;
  at: string;
  before: unknown;
  after: unknown;
  reference: string;
}

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
}

export async function emitAudit(
  store: AuditStore,
  event: Omit<AuditEvent, "at">,
  now: () => Date = () => new Date(),
): Promise<AuditEvent> {
  if (!event.actor || !event.subject || !event.reference) {
    throw new Error("an audit event needs an actor, a subject and a reference");
  }
  const recorded: AuditEvent = { ...event, at: now().toISOString() };
  await store.append(recorded);
  return recorded;
}

/**
 * The database the refund API uses, as an interface: production wires in the payments database client, tests a fake.
 * Values are passed as bound parameters, never written into the SQL text (SCS-031).
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

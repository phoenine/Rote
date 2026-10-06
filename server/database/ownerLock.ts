import { eq } from 'drizzle-orm';
import { users } from '../drizzle/schema';
import type db from '../utils/drizzle';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared lock order for owner-scoped writes and attachment cleanup. */
export async function lockDatabaseOwner(transaction: Transaction, ownerId: string) {
  const [owner] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ownerId))
    .for('update');
  if (!owner) throw new Error('User not found');
}

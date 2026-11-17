import { db, EndpointError } from 'sdk';
import { settings } from '../schema.js';

export default async function (input, ctx) {
  // Defense in depth: a real Mini App call always carries verified initData.
  // If this file were ever deployed by mistake, refuse every real call.
  if (ctx?.initData?.user) {
    throw new EndpointError('Forbidden', { code: 'FORBIDDEN' });
  }

  const id = Number(input?.ownerId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid ownerId: must be a positive safe integer');
  }

  await db.insert(settings)
    .values({ key: 'owner_id', value: String(id), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(id), updatedAt: new Date() },
    })
    .run();

  return { ok: true }; // Never return or log the ownerId itself
}

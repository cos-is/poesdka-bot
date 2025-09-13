import db from '../db/db.mjs'

export async function getSetting(key) {
  const row = await db('app_settings').where({ key }).first();
  return row?.value || null;
}
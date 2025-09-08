export const up = async (knex) => {
  // Проверяем наличие колонки и её тип безопасно
  const hasStatus = await knex.schema.hasColumn('bookings','status');
  if (!hasStatus) return; // ничего делать

  let columnType;
  try {
    const rawRes = await knex.raw("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_NAME='bookings' AND COLUMN_NAME='status' AND TABLE_SCHEMA=DATABASE()");
    // MySQL возвращает [rows, fields]
    const rows = Array.isArray(rawRes) ? (Array.isArray(rawRes[0]) ? rawRes[0] : rawRes) : [];
    columnType = rows && rows[0] && rows[0].COLUMN_TYPE;
  } catch (e) {
    console.warn('Cannot inspect bookings.status COLUMN_TYPE:', e.message);
  }
  if (columnType && typeof columnType === 'string' && columnType.startsWith('enum')) {
    const hasOld = await knex.schema.hasColumn('bookings','status_old');
    if (!hasOld) {
      await knex.schema.table('bookings', t => t.renameColumn('status','status_old'));
      await knex.schema.table('bookings', t => t.string('status').notNullable().defaultTo('active'));
      await knex('bookings').update({ status: knex.ref('status_old') });
      await knex.schema.table('bookings', t => t.dropColumn('status_old'));
    }
  }
};

export const down = async (knex) => {
  // Отмена: не восстанавливаем enum (опасно). Оставляем string.
};
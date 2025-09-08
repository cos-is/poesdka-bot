export const up = async (knex) => {
  // Индексы для ускорения выборок
  const addIndex = async (table, indexName, columns) => {
    try { await knex.schema.table(table, t => t.index(columns, indexName)); } catch(e) { /* ignore if exists */ }
  };
  await addIndex('bookings','idx_bookings_trip_instance_status',['trip_instance_id','status']);
  await addIndex('bookings','idx_bookings_user_status',['user_id','status']);
  await addIndex('payments','idx_payments_provider_payment_id',['provider_payment_id']);
  await addIndex('bookings','idx_bookings_payment_id',['payment_id']);
  // Составной индекс для предотвращения дубликатов бронирования одного пользователя одной поездки (независимо от статуса)
  try { await knex.schema.table('bookings', t => t.unique(['trip_instance_id','user_id'],'uq_booking_trip_user')); } catch(e) { /* ignore */ }
};

export const down = async (knex) => {
  const drop = async (table, indexName) => { try { await knex.schema.table(table, t => t.dropIndex([], indexName)); } catch(e) { /* ignore */ } };
  await drop('bookings','idx_bookings_trip_instance_status');
  await drop('bookings','idx_bookings_user_status');
  await drop('payments','idx_payments_provider_payment_id');
  await drop('bookings','idx_bookings_payment_id');
  try { await knex.schema.table('bookings', t => t.dropUnique(['trip_instance_id','user_id'],'uq_booking_trip_user')); } catch(e) { /* ignore */ }
};
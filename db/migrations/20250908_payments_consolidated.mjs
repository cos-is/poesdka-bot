// Consolidated migration: payments + booking extensions (replaces several 20250908_* files)
export const up = async (knex) => {
  // 1. payments table with idempotence_key
  const hasPayments = await knex.schema.hasTable('payments');
  if (!hasPayments) {
    await knex.schema.createTable('payments', table => {
      table.increments('id').primary();
      table.string('provider').notNullable().defaultTo('yookassa');
      table.string('provider_payment_id').notNullable().index();
      table.decimal('amount', 10, 2).notNullable();
      table.string('currency', 10).notNullable().defaultTo('RUB');
      table.string('status').notNullable(); // pending | succeeded | canceled
      table.string('description');
      table.string('idempotence_key').index();
      table.json('raw');
      table.timestamps(true, true);
    });
  } else {
    const hasIdem = await knex.schema.hasColumn('payments','idempotence_key');
    if (!hasIdem) {
      await knex.schema.table('payments', t => t.string('idempotence_key').index());
    }
  }

  // 2. Add payment_id column to bookings if missing
  const hasPaymentId = await knex.schema.hasColumn('bookings','payment_id');
  if (!hasPaymentId) {
    await knex.schema.table('bookings', t => {
      t.integer('payment_id').unsigned().references('id').inTable('payments').onDelete('SET NULL');
    });
  }

  // 3. Convert enum status->string if still enum
  try {
    const res = await knex.raw("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_NAME='bookings' AND COLUMN_NAME='status' AND TABLE_SCHEMA=DATABASE()");
    const columnType = res?.[0]?.[0]?.COLUMN_TYPE || res?.[0]?.COLUMN_TYPE;
    if (columnType && columnType.startsWith('enum')) {
      const hasOld = await knex.schema.hasColumn('bookings','status_old');
      if (!hasOld) {
        await knex.schema.table('bookings', t => t.renameColumn('status','status_old'));
        await knex.schema.table('bookings', t => t.string('status').notNullable().defaultTo('active'));
        await knex('bookings').update({ status: knex.ref('status_old') });
        await knex.schema.table('bookings', t => t.dropColumn('status_old'));
      }
    }
  } catch (e) {
    console.warn('Status enum conversion check failed', e.message);
  }

  // 4. expires_at column
  const hasExpires = await knex.schema.hasColumn('bookings','expires_at');
  if (!hasExpires) {
    await knex.schema.table('bookings', t => {
      t.timestamp('expires_at').nullable().index();
    });
  }

  // 5. Indexes
  const addIndex = async (table, indexName, cols) => {
    try { await knex.schema.table(table, t => t.index(cols, indexName)); } catch { /* ignore */ }
  };
  await addIndex('bookings','idx_bookings_trip_instance_status',['trip_instance_id','status']);
  await addIndex('bookings','idx_bookings_user_status',['user_id','status']);
  await addIndex('payments','idx_payments_provider_payment_id',['provider_payment_id']);
  await addIndex('bookings','idx_bookings_payment_id',['payment_id']);

  // 6. Unique booking per user per trip (note: blocks re-book after cancel)
  try { await knex.schema.table('bookings', t => t.unique(['trip_instance_id','user_id'],'uq_booking_trip_user')); } catch { /* ignore */ }

  // refunds moved to a separate migration (20250912_add_refunds_table)
};

export const down = async (knex) => {
  // Non destructive: only drop added indexes / unique (keep data & columns)
  const dropIdx = async (table, idx) => { try { await knex.schema.table(table, t => t.dropIndex([], idx)); } catch { /* ignore */ } };
  await dropIdx('bookings','idx_bookings_trip_instance_status');
  await dropIdx('bookings','idx_bookings_user_status');
  await dropIdx('payments','idx_payments_provider_payment_id');
  await dropIdx('bookings','idx_bookings_payment_id');
  try { await knex.schema.table('bookings', t => t.dropUnique(['trip_instance_id','user_id'],'uq_booking_trip_user')); } catch { /* ignore */ }
  // refunds table is managed by its own migration
};

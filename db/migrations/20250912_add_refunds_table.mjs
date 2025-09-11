// New migration: refunds table with booking_id and indexes
export const up = async (knex) => {
  const hasRefunds = await knex.schema.hasTable('refunds');
  if (!hasRefunds) {
    await knex.schema.createTable('refunds', t => {
      t.increments('id').primary();
      t.integer('payment_id').unsigned().references('id').inTable('payments').onDelete('CASCADE');
      t.integer('booking_id').unsigned().references('id').inTable('bookings').onDelete('SET NULL');
      t.string('provider_refund_id');
      t.decimal('amount', 10, 2).notNullable();
      t.string('currency', 10).defaultTo('RUB');
      t.string('status');
      t.json('raw');
      t.timestamps(true, true);
    });
    try { await knex.schema.table('refunds', t => t.index(['payment_id'])); } catch {}
    try { await knex.schema.table('refunds', t => t.index(['booking_id'])); } catch {}
  }
};

export const down = async (knex) => {
  try { await knex.schema.dropTable('refunds'); } catch {}
};

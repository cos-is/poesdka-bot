// Migration: add payments table and payment_id column to bookings

export async function up(knex) {
  const hasPayments = await knex.schema.hasTable('payments');
  if (!hasPayments) {
    await knex.schema.createTable('payments', table => {
      table.increments('id').primary();
      table.string('provider').notNullable().defaultTo('yookassa');
      table.string('provider_payment_id').notNullable().index();
      table.decimal('amount', 10, 2).notNullable();
      table.string('currency', 10).notNullable().defaultTo('RUB');
      table.string('status').notNullable(); // pending, succeeded, canceled
      table.string('description');
      table.json('raw');
      table.timestamps(true, true);
    });
  }
  const hasPaymentIdColumn = await knex.schema.hasColumn('bookings', 'payment_id');
  if (!hasPaymentIdColumn) {
    await knex.schema.table('bookings', table => {
      table.integer('payment_id').unsigned().nullable().references('id').inTable('payments').onDelete('SET NULL');
      // Не изменяем тип status здесь чтобы не ломать enum — отдельная миграция сделает string
    });
  }
}

export async function down(knex) {
  const hasPaymentIdColumn = await knex.schema.hasColumn('bookings', 'payment_id');
  if (hasPaymentIdColumn) {
    await knex.schema.table('bookings', table => {
      table.dropColumn('payment_id');
    });
  }
  const hasPayments = await knex.schema.hasTable('payments');
  if (hasPayments) {
    await knex.schema.dropTable('payments');
  }
}

export const up = async (knex) => {
  const exists = await knex.schema.hasTable('app_settings');
  if (!exists) {
    await knex.schema.createTable('app_settings', (table) => {
      table.increments('id').primary();
      table.string('key').unique().notNullable();
      table.text('value');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists('app_settings');
};

export const up = async (knex) => {
  const hasTable = await knex.schema.hasTable('trip_instances');
  if (!hasTable) return;
  const hasCol = await knex.schema.hasColumn('trip_instances', 'created_at');
  if (!hasCol) {
    await knex.schema.alterTable('trip_instances', (table) => {
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

export const down = async (knex) => {
  const hasTable = await knex.schema.hasTable('trip_instances');
  if (!hasTable) return;
  const hasCol = await knex.schema.hasColumn('trip_instances', 'created_at');
  if (hasCol) {
    await knex.schema.alterTable('trip_instances', (table) => {
      table.dropColumn('created_at');
    });
  }
};

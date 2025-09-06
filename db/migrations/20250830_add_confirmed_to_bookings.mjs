export const up = async (knex) => {
  await knex.schema.alterTable('bookings', function(table) {
    table.boolean('confirmed').defaultTo(false).notNullable();
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable('bookings', function(table) {
    table.dropColumn('confirmed');
  });
};

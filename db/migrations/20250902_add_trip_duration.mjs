export const up = async (knex) => {
  await knex.schema.alterTable('trip_instances', function(table) {
    table.string('duration').nullable(); // Время в пути, строкой (например, "2:30")
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable('trip_instances', function(table) {
    table.dropColumn('duration');
  });
};

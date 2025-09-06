// 20250831_add_locations_to_trip_instances.mjs
// Добавляет поля для адресов и локаций отправления/прибытия в trip_instances

export const up = async (knex) => {
  await knex.schema.alterTable('trip_instances', table => {
    table.decimal('departure_lat', 10, 7);
    table.decimal('departure_lng', 10, 7);
    table.string('departure_address');
    table.decimal('arrival_lat', 10, 7);
    table.decimal('arrival_lng', 10, 7);
    table.string('arrival_address');
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable('trip_instances', table => {
    table.dropColumn('departure_lat');
    table.dropColumn('departure_lng');
    table.dropColumn('departure_address');
    table.dropColumn('arrival_lat');
    table.dropColumn('arrival_lng');
    table.dropColumn('arrival_address');
  });
};

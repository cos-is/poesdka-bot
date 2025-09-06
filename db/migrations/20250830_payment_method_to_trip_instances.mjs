export async function up(knex) {
  // Удаляем старое поле из trips
  await knex.schema.alterTable('trips', table => {
    table.dropColumn('payment_type');
  });
  // Добавляем новое поле в trip_instances
  await knex.schema.alterTable('trip_instances', table => {
    table.string('payment_method', 32).notNullable().defaultTo('both');
  });
}

export async function down(knex) {
  // Откатываем изменения
  await knex.schema.alterTable('trip_instances', table => {
    table.dropColumn('payment_method');
  });
  await knex.schema.alterTable('trips', table => {
    table.string('payment_type', 32).notNullable().defaultTo('both');
  });
}

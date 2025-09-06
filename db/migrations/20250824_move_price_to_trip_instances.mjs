export const up = async (knex) => {
  // Удалить поле price из trips, если оно есть
  const hasTripsPrice = await knex.schema.hasColumn('trips', 'price');
  if (hasTripsPrice) {
    await knex.schema.table('trips', t => t.dropColumn('price'));
  }
  // Добавить поле price в trip_instances, если его нет
  const hasInstancesPrice = await knex.schema.hasColumn('trip_instances', 'price');
  if (!hasInstancesPrice) {
    await knex.schema.table('trip_instances', t => t.integer('price').notNullable().defaultTo(0));
  }
};

export const down = async (knex) => {
  // Откатить изменения: вернуть price в trips, убрать из trip_instances
  const hasInstancesPrice = await knex.schema.hasColumn('trip_instances', 'price');
  if (hasInstancesPrice) {
    await knex.schema.table('trip_instances', t => t.dropColumn('price'));
  }
  const hasTripsPrice = await knex.schema.hasColumn('trips', 'price');
  if (!hasTripsPrice) {
    await knex.schema.table('trips', t => t.integer('price').notNullable().defaultTo(0));
  }
};

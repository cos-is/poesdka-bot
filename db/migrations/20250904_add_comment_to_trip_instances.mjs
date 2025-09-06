export async function up(knex) {
  await knex.schema.table('trip_instances', table => {
    table.text('comment').nullable().comment('Комментарий водителя для пассажиров');
  });
}

export async function down(knex) {
  await knex.schema.table('trip_instances', table => {
    table.dropColumn('comment');
  });
}

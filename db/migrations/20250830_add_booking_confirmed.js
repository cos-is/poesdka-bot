// Migration: add 'confirmed' field to bookings

exports.up = async function(knex) {
  await knex.schema.table('bookings', function(table) {
    table.boolean('confirmed').notNullable().defaultTo(false);
  });
};

exports.down = async function(knex) {
  await knex.schema.table('bookings', function(table) {
    table.dropColumn('confirmed');
  });
};

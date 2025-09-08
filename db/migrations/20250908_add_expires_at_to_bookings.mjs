export const up = async (knex) => {
  const has = await knex.schema.hasColumn('bookings','expires_at');
  if (!has) {
    await knex.schema.table('bookings', table => {
      table.timestamp('expires_at').nullable().index();
    });
  }
};

export const down = async (knex) => {
  const has = await knex.schema.hasColumn('bookings','expires_at');
  if (has) {
    await knex.schema.table('bookings', table => {
      table.dropColumn('expires_at');
    });
  }
};
export const up = async (knex) => {
  const has = await knex.schema.hasColumn('payments','idempotence_key');
  if (!has) {
    await knex.schema.table('payments', table => {
      table.string('idempotence_key').index();
    });
  }
};

export const down = async (knex) => {
  const has = await knex.schema.hasColumn('payments','idempotence_key');
  if (has) {
    await knex.schema.table('payments', table => {
      table.dropColumn('idempotence_key');
    });
  }
};

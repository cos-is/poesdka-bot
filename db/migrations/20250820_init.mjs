export const up = async (knex) => {
  await knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.bigInteger('telegram_id').unique().notNullable();
    table.string('name').notNullable();
    table.string('phone').notNullable();
    table.enum('role', ['driver', 'passenger']).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cars', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('brand').notNullable();
    table.string('model').notNullable();
    table.string('license_plate').notNullable();
    table.string('color');
    table.string('photo_url');
    table.boolean('is_default').defaultTo(false);
  });
   // Города для маршрутов
  await knex.schema.createTable('cities', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('region');
    table.boolean('is_active').defaultTo(true);
  });
  await knex.schema.createTable('routes', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('direction').notNullable();
    table.string('preset_code').notNullable();
  });

  await knex.schema.createTable('route_points', function(table) {
    table.increments('id').primary();
    table.integer('route_id').unsigned().references('id').inTable('routes').onDelete('CASCADE');
    table.integer('city_id').unsigned().references('id').inTable('cities').onDelete('RESTRICT');
    table.integer('order').notNullable();
  });

  await knex.schema.createTable('trips', function(table) {
    table.increments('id').primary();
    table.integer('driver_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('car_id').unsigned().references('id').inTable('cars').onDelete('SET NULL');
    table.integer('route_id').unsigned().references('id').inTable('routes').onDelete('SET NULL');
    table.integer('departure_city_id').unsigned().references('id').inTable('cities').onDelete('RESTRICT');
    table.string('departure_place');
    table.integer('arrival_city_id').unsigned().references('id').inTable('cities').onDelete('RESTRICT');
    table.string('arrival_place');
    table.json('pickup_points');
    table.boolean('is_series').defaultTo(false);
    table.integer('series_id').unsigned();
    table.integer('seats').notNullable();
    table.integer('price').notNullable();
    table.boolean('parcels').defaultTo(false);
    table.enum('payment_type', ['cash', 'transfer', 'both']).defaultTo('both');
    table.text('note');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('trip_times', function(table) {
    table.increments('id').primary();
    table.integer('trip_id').unsigned().references('id').inTable('trips').onDelete('CASCADE');
    table.time('departure_time').notNullable();
  });

  await knex.schema.createTable('trip_instances', function(table) {
    table.increments('id').primary();
    table.integer('trip_id').unsigned().references('id').inTable('trips').onDelete('CASCADE');
    table.date('departure_date').notNullable();
    table.time('departure_time').notNullable();
    table.integer('available_seats').notNullable();
    table.enum('status', ['active', 'cancelled', 'completed']).defaultTo('active');
  });

  await knex.schema.createTable('bookings', function(table) {
    table.increments('id').primary();
    table.integer('trip_instance_id').unsigned().references('id').inTable('trip_instances').onDelete('CASCADE');
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('seats').notNullable();
    table.enum('status', ['active', 'cancelled', 'completed']).defaultTo('active');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('booking_payments', function(table) {
    table.increments('id').primary();
    table.integer('booking_id').unsigned().references('id').inTable('bookings').onDelete('CASCADE');
    table.integer('amount').notNullable();
    table.enum('status', ['pending', 'paid', 'failed']).defaultTo('pending');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('passenger_requests', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('from_city_id').unsigned().references('id').inTable('cities').onDelete('RESTRICT');
    table.integer('to_city_id').unsigned().references('id').inTable('cities').onDelete('RESTRICT');
    table.date('date').notNullable();
    table.integer('seats').notNullable();
    table.text('note');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists('passenger_requests');
  await knex.schema.dropTableIfExists('booking_payments');
  await knex.schema.dropTableIfExists('bookings');
  await knex.schema.dropTableIfExists('trip_instances');
  await knex.schema.dropTableIfExists('trip_times');
  await knex.schema.dropTableIfExists('trips');
  await knex.schema.dropTableIfExists('route_points');
  await knex.schema.dropTableIfExists('routes');
  await knex.schema.dropTableIfExists('cars');
  await knex.schema.dropTableIfExists('users');
};

// Очередь для операций над поездками (создание, обновление, отмена) через BullMQ
import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

export const tripQueue = new Queue('trip', { connection });

// Воркеры для обработки задач над поездками
export function startTripWorker(knex) {
  new Worker('trip', async job => {
    const { action, data } = job.data;
    if (action === 'cancel') {
      // Отмена поездки и всех экземпляров
      await knex('trips').where('id', data.tripId).update({ status: 'cancelled' });
      await knex('trip_instances').where('trip_id', data.tripId).update({ status: 'cancelled' });
      // Уведомления пассажирам
      const botModule = await import('../index.mjs');
      const bot = botModule.poezdkaBot || botModule.bot;
      // Получить все активные бронирования на эту поездку
      const bookings = await knex('bookings')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .where('trip_instances.trip_id', data.tripId)
        .andWhere('bookings.status', 'active')
        .select('bookings.user_id', 'trip_instances.departure_date', 'trip_instances.departure_time');
      for (const b of bookings) {
        try {
          await bot.telegram.sendMessage(
            b.user_id,
            `Ваша бронь на поездку, запланированную на ${b.departure_date} ${b.departure_time}, была отменена водителем. Извините за неудобства.`
          );
        } catch (e) { /* ignore */ }
      }
      return 'cancelled';
    }
    if (action === 'update_seats') {
      await knex('trips').where('id', data.tripId).update({ seats: data.seats });
      await knex('trip_instances').where('trip_id', data.tripId).update({ available_seats: data.seats });
      // Уведомления пассажирам о смене количества мест
      const botModule = await import('../index.mjs');
      const bot = botModule.poezdkaBot || botModule.bot;
      const bookings = await knex('bookings')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .where('trip_instances.trip_id', data.tripId)
        .andWhere('bookings.status', 'active')
        .select('bookings.user_id');
      for (const b of bookings) {
        try {
          await bot.telegram.sendMessage(
            b.user_id,
            `В поездке, которую вы забронировали, изменилось количество мест. Если это важно — проверьте детали поездки.`
          );
        } catch (e) { /* ignore */ }
      }
      return 'seats_updated';
    }
    if (action === 'update_price') {
      await knex('trips').where('id', data.tripId).update({ price: data.price });
      // Уведомления пассажирам о смене цены
      const botModule = await import('../index.mjs');
      const bot = botModule.poezdkaBot || botModule.bot;
      const bookings = await knex('bookings')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .where('trip_instances.trip_id', data.tripId)
        .andWhere('bookings.status', 'active')
        .select('bookings.user_id');
      for (const b of bookings) {
        try {
          await bot.telegram.sendMessage(
            b.user_id,
            `В поездке, которую вы забронировали, изменилась цена за место. Если это важно — проверьте детали поездки.`
          );
        } catch (e) { /* ignore */ }
      }
      return 'price_updated';
    }
    return null;
  }, { connection });
}

export async function addTripJob(action, data) {
  await tripQueue.add(action, { action, data }, { removeOnComplete: true, removeOnFail: true });
}

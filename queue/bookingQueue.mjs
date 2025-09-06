// Очередь бронирований через BullMQ
import { Queue, Worker } from 'bullmq';
import Knex from 'knex';
import dotenv from 'dotenv';
dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

export const bookingQueue = new Queue('booking', { connection });

// Пример воркера для обработки бронирования
export function startBookingWorker(knex) {
  new Worker('booking', async job => {
    const { tripInstanceId, userId, seats } = job.data;
    return await knex.transaction(async trx => {
      // Проверка доступных мест
      const trip = await trx('trip_instances').where({ id: tripInstanceId }).first();
      if (!trip || trip.available_seats < seats) throw new Error('Not enough seats');
      // Обновление мест
      await trx('trip_instances').where({ id: tripInstanceId }).decrement('available_seats', seats);
      // Создание брони
      const [bookingId] = await trx('bookings').insert({ trip_instance_id: tripInstanceId, user_id: userId, seats });
      return bookingId;
    });
  }, { connection });
}

export async function addBookingJob(data) {
  const result = await bookingQueue.add('book', data, { removeOnComplete: true, removeOnFail: true });
  console.log('Booking job added:', result);
}

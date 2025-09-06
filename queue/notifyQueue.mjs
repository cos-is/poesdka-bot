// Очередь для уведомлений водителя о событиях с бронями
import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

export const notifyQueue = new Queue('notify', { connection });

export function startNotifyWorker(knex) {
  new Worker('notify', async job => {
    console.log('new job', job)
    const { type, driverId, message, bookingId } = job.data;
    if (!driverId || !message) return;
    const botModule = await import('../index.mjs');
    const bot = botModule.poezdkaBot || botModule.bot;
    try {
      if (type === 'booking_new' && bookingId) {
        console.log('Новая бронь:', message);
        // Кнопки подтверждения/отмены
        await bot.telegram.sendMessage(driverId, message, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Подтвердить', callback_data: `driver_confirm_booking_${bookingId}` },
                { text: 'Отклонить', callback_data: `driver_reject_booking_${bookingId}` }
              ]
            ]
          }
        });
      } else {
        await bot.telegram.sendMessage(driverId, message);
      }
    } catch (e) { /* ignore */ }
  }, { connection });
}

export async function addNotifyJob(type, driverId, message, bookingId = null) {
  await notifyQueue.add(type, { type, driverId, message, bookingId }, { removeOnComplete: true, removeOnFail: true });
}

// Очередь для операций над поездками (создание, обновление, отмена) через BullMQ
import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import { formatDate, formatTime } from '../utils/formatDate.mjs'
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
      // Отмена только выбранного инстанса поездки (базовую запись trips не трогаем)
      if (!data?.instanceId) {
        return 'no_instance_specified';
      }
      await knex('trip_instances').where('id', data.instanceId).update({ status: 'cancelled' });
      // Автовозвраты для всех оплаченных броней, отмена броней и возврат мест
      const botModule = await import('../index.mjs');
      const bot = botModule.poezdkaBot || botModule.bot;
      const { initYooCheckout } = await import('../bot/logic/payments.mjs');
      const { createRefund } = await import('../bot/logic/payments.mjs');
      const yc = initYooCheckout();
      const affectedBookings = await knex('bookings')
        .join('trip_instances','bookings.trip_instance_id','trip_instances.id')
        .join('users','bookings.user_id','users.id')
        .where('trip_instances.id', data.instanceId)
        .whereIn('bookings.status', ['active','pending','awaiting_confirmation'])
        .select(
          'bookings.*',
          'trip_instances.departure_date',
          'trip_instances.departure_time',
          'users.telegram_id as passenger_telegram_id'
        );
      for (const b of affectedBookings) {
        // Вернуть места, если они были уже зарезервированы (мы резервируем при создании pending)
        try {
          await knex.transaction(async trx => {
            await trx('trip_instances').where({ id: b.trip_instance_id }).increment('available_seats', b.seats);
            await trx('bookings').where({ id: b.id }).update({ status: 'cancelled', confirmed: false });
          });
        } catch {/* ignore */}
        // Если была успешная оплата — оформить возврат
        if (b.payment_id && yc) {
          const pay = await knex('payments').where({ id: b.payment_id }).first();
          if (pay && pay.status === 'succeeded' && pay.provider_payment_id) {
            try {
              const idemp = `refund-trip-cancel-${b.id}-${Date.now()}`;
              const refund = await createRefund(yc, {
                providerPaymentId: pay.provider_payment_id,
                amount: pay.amount,
                description: `Возврат комиссии: отмена поездки, бронь #${b.id}`,
                idempotenceKey: idemp,
              });
              await knex('payments').where({ id: b.payment_id }).update({ raw: JSON.stringify({ ...(pay.raw || {}), refund }) });
              try {
                await knex('refunds').insert({
                  payment_id: b.payment_id,
                  booking_id: b.id,
                  provider_refund_id: refund?.id || null,
                  amount: pay.amount,
                  currency: pay.currency || 'RUB',
                  status: refund?.status || 'created',
                  raw: JSON.stringify(refund || {})
                });
              } catch (e) {
                console.error('Refund insert error', e);
              }
            } catch (e) {
              console.error('Refund error', e);
            }
          }
        }
        // Уведомление пассажиру
        try {
          if (b.passenger_telegram_id) {
            await bot.telegram.sendMessage(
              b.passenger_telegram_id,
              `Ваша бронь на поездку ${formatDate(b.departure_date)} ${formatTime(b.departure_time)} отменена водителем. Если комиссия была оплачена — возврат оформлен.`
            );
          }
        } catch (e) {
          console.error('Notification error', e);
        }
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
        .join('users', 'bookings.user_id', 'users.id')
        .where('trip_instances.trip_id', data.tripId)
        .andWhere('bookings.status', 'active')
        .select('users.telegram_id as passenger_telegram_id');
      for (const b of bookings) {
        try {
          if (b.passenger_telegram_id) {
            await bot.telegram.sendMessage(
              b.passenger_telegram_id,
              `В поездке, которую вы забронировали, изменилось количество мест. Если это важно — проверьте детали поездки.`
            );
          }
        } catch (e) {
          console.log('Notification error', e);
        }
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
        .join('users', 'bookings.user_id', 'users.id')
        .where('trip_instances.trip_id', data.tripId)
        .andWhere('bookings.status', 'active')
        .select('users.telegram_id as passenger_telegram_id');
      for (const b of bookings) {
        try {
          if (b.passenger_telegram_id) {
            await bot.telegram.sendMessage(
              b.passenger_telegram_id,
              `В поездке, которую вы забронировали, изменилась цена за место. Если это важно — проверьте детали поездки.`
            );
          }
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

import dotenv from 'dotenv'
dotenv.config({  path: './.env' })
import express from 'express'
import localtunnel from 'localtunnel'
import bodyParser from 'body-parser'
import { Telegraf, Markup, session } from 'telegraf'
import { passengerLogic } from './bot/logic/passenger.mjs';
import { driverLogic } from './bot/logic/driver.mjs';
import { adminLogic } from './bot/logic/admin.mjs'
import { startBookingWorker } from './queue/bookingQueue.mjs';
import { startTripWorker } from './queue/tripQueue.mjs';
import { startNotifyWorker } from './queue/notifyQueue.mjs';
import cors from 'cors'
import db from './db/db.mjs'
import { commonLogic } from './bot/logic/common.mjs'
import { handleCalendar } from './bot/logic/calendar.mjs'
import { afterAll } from './bot/logic/afterAll.mjs'
import { initYooCheckout, verifyYooSignature } from './bot/logic/payments.mjs'
import { formatPhone } from './utils/formatPhone.mjs'
import { addNotifyJob } from './queue/notifyQueue.mjs'
const corsConfig = {
  origin: '*'
}

const {
  POEZDKA_BOT_TOKEN,
  POEZDKA_ADMIN_BOT_TOKEN,
  PUBLIC_URL
} = process.env

const app = express()
app.use(bodyParser.json({ limit: '200mb' }))
app.use(cors(corsConfig))
const port = 3015

// Инициализация YooKassa
const yoo = initYooCheckout()

app.get('/yookassa/webhook', async (req, res) => {
  res.status(200).send('ok')
})
// Webhook для YooKassa
app.post('/yookassa/webhook', async (req, res) => {
  console.log(req)
  try {
    if (!verifyYooSignature(req)) {
      return res.status(403).send('forbidden');
    }
    const event = req.body;
    if (!event || !event.object) {
      return res.status(400).send('bad');
    }
    const knex = db;
    const obj = event.object;
    const provider_payment_id = obj.id;
    // Найти платеж
    const payment = await knex('payments').where({ provider_payment_id }).first();
    if (!payment) {
      // Сохраняем как неизвестный
      await knex('payments').insert({ provider: 'yookassa', provider_payment_id, amount: obj.amount.value, currency: obj.amount.currency, status: obj.status, description: obj.description || null, raw: JSON.stringify(obj) });
      return res.status(200).send('ok');
    }
    // Валидация суммы и пересчёт комиссии (50р за место либо COMMISSION_PER_SEAT)
    if (!obj.amount || !obj.amount.value) {
      return res.status(400).send('bad amount');
    }
    const bookingForAmount = await knex('bookings').where({ payment_id: payment.id }).first();
    if (bookingForAmount) {
      const perSeat = parseInt(process.env.COMMISSION_PER_SEAT || '50', 10);
      const expected = (perSeat * bookingForAmount.seats).toFixed(2);
      const paid = parseFloat(obj.amount.value).toFixed(2);
      if (expected !== paid) {
        console.warn('Commission mismatch', { expected, paid, booking: bookingForAmount.id });
        // Можно отклонить: return res.status(400).send('amount mismatch');
      }
    }
    // Идемпотентное обновление статуса (меняем только если был pending)
    await knex('payments').where({ id: payment.id, status: payment.status }).update({ status: obj.status, raw: JSON.stringify(obj) });
    // Если succeeded — переводим бронь в ожидание подтверждения водителем
    if (obj.status === 'succeeded') {
      const booking = await knex('bookings').where({ payment_id: payment.id }).first();
      if (booking && booking.status === 'pending') {
        // Обновляем статус на ожидание подтверждения водителя и снимаем срок жизни
        await knex('bookings').where({ id: booking.id }).update({ status: 'awaiting_confirmation', confirmed: false, expires_at: null });
        // Подготовить данные для уведомлений
        const info = await knex('bookings')
          .join('trip_instances','bookings.trip_instance_id','trip_instances.id')
          .join('trips','trip_instances.trip_id','trips.id')
          .join('cities as dep','trips.departure_city_id','dep.id')
          .join('cities as arr','trips.arrival_city_id','arr.id')
          .join('users as passenger','bookings.user_id','passenger.id')
          .join('users as driver','trips.driver_id','driver.id')
          .select(
            'bookings.id as booking_id','bookings.seats','trip_instances.departure_date','trip_instances.departure_time',
            'dep.name as departure_city','arr.name as arrival_city',
            'passenger.telegram_id as passenger_tg','passenger.name as passenger_name','passenger.phone as passenger_phone',
            'driver.telegram_id as driver_tg'
          ).where('bookings.id', booking.id).first();
        if (info) {
          const passengerPhone = info.passenger_phone ? formatPhone(info.passenger_phone) : '-';
          const driverMessage = `Новая оплаченная бронь #${info.booking_id}\n`+
            `Маршрут: ${info.departure_city} → ${info.arrival_city}\n`+
            `Дата: ${info.departure_date}, время: ${info.departure_time}\n`+
            `Мест: ${info.seats}\n`+
            `Пассажир: ${info.passenger_name || '-'} (${passengerPhone})`;
          await addNotifyJob('booking_new', info.driver_tg, driverMessage, booking.id);
          await addNotifyJob('booking_paid', info.passenger_tg, `Оплата прошла! Заявка #${info.booking_id} отправлена водителю. Ожидайте подтверждения.`, booking.id);
        }
      }
    } else if (obj.status === 'canceled') {
      // Освободить места, если была бронь на удержании (pending/awaiting_confirmation)
      const booking = await knex('bookings').where({ payment_id: payment.id }).first();
      if (booking && (booking.status === 'pending' || booking.status === 'awaiting_confirmation')) {
        await knex.transaction(async trx => {
          await trx('trip_instances').where({ id: booking.trip_instance_id }).increment('available_seats', booking.seats);
          await trx('bookings').where({ id: booking.id }).update({ status: 'cancelled' });
        });
        const passenger = await knex('users').where({ id: booking.user_id }).first();
        if (passenger) {
          await addNotifyJob('payment_cancelled', passenger.telegram_id, 'Оплата отменена. Бронирование аннулировано.', booking.id);
        }
      }
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).send('error');
  }
});


export const poezdkaBot = new Telegraf(POEZDKA_BOT_TOKEN)
const poezdkaAdminBot = new Telegraf(POEZDKA_ADMIN_BOT_TOKEN)
poezdkaAdminBot.use(session())
poezdkaBot.use(session())


// Подключаем логику пассажира и водителя
poezdkaBot.telegram.setMyCommands([
  { command: '/start', description: 'Начать' },
  { command: '/support', description: 'Поддержка' }
])
poezdkaBot.use(commonLogic(db))
poezdkaBot.use(handleCalendar(poezdkaBot))
poezdkaBot.use(driverLogic(db));
poezdkaBot.use(passengerLogic(db));
poezdkaBot.use(afterAll(db))

// Подключаем логику администратора
poezdkaAdminBot.use(adminLogic(db));

// Запуск воркеров очередей
startBookingWorker(db);
startTripWorker(db);
startNotifyWorker(db);

const poezdkaBotWebhookPath = '/telegram/webhook/poezdka/'
const poezdkaAdminBotWebhookPath = '/telegram/webhook/poezdka-admin/'


let publicUrl = PUBLIC_URL
console.log('PUBLIC_URL', PUBLIC_URL)

if (!PUBLIC_URL) {
  const { url } = await localtunnel({ port })
  publicUrl = url
}

console.log(`Public domain: ${publicUrl}`)

await poezdkaBot.telegram.setWebhook(`${publicUrl}${poezdkaBotWebhookPath}`)
await poezdkaAdminBot.telegram.setWebhook(`${publicUrl}${poezdkaAdminBotWebhookPath}`)


poezdkaBot.launch()
poezdkaAdminBot.launch()
app.listen(port, () => {
  console.log(`Server service listening on port ${port}`)
})
async function onShutdown () {
  await poezdkaBot.telegram.deleteWebhook()
  await poezdkaAdminBot.telegram.deleteWebhook()
  poezdkaBot.stop()
  poezdkaAdminBot.stop()
}


if (!PUBLIC_URL) {
  console.log(`Public domain: ${publicUrl}`)
}


process.on('SIGTERM', onShutdown)
process.on('uncaughtException', onShutdown)
process.on('unhandledRejection', onShutdown)
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


export const poezdkaBot = new Telegraf(POEZDKA_BOT_TOKEN)
const poezdkaAdminBot = new Telegraf(POEZDKA_ADMIN_BOT_TOKEN)
poezdkaAdminBot.use(session())
poezdkaBot.use(session())


// Подключаем логику пассажира и водителя
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
console.log(POEZDKA_ADMIN_BOT_TOKEN)

await poezdkaBot.telegram.setWebhook(`${publicUrl}${poezdkaBotWebhookPath}`)
await poezdkaAdminBot.telegram.setWebhook(`${publicUrl}${poezdkaAdminBotWebhookPath}`)


poezdkaBot.launch()
poezdkaAdminBot.launch()
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
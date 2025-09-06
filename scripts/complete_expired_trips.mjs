// Скрипт для завершения просроченных активных поездок
// Запускать через: node scripts/complete_expired_trips.mjs
import knexConfig from '../knexfile.mjs';
import knex from 'knex';
import { getDate } from '../utils/formatDate.mjs'

const db = knex(knexConfig);

function pad(num) {
  return num.toString().padStart(2, '0');
}

function parseDuration(duration) {
  // duration: "2:30" => 2 часа 30 минут
  if (!duration) return 0;
  const [h, m] = duration.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

async function main() {
  const now = getDate()
  // Получаем все активные поездки с duration и временем отправления
  const trips = await db('trip_instances')
    .where('status', 'active')
    .select('id', 'departure_date', 'departure_time', 'duration');

  let completed = 0;
  for (const trip of trips) {
    if (!trip.departure_date || !trip.departure_time || !trip.duration) continue;
    // Формируем дату-время отправления
    const [h, m] = trip.departure_time.split(':').map(Number);
    const depDate = new Date(trip.departure_date + 'T' + pad(h) + ':' + pad(m) + ':00');
    const mins = parseDuration(trip.duration);
    const endDate = addMinutes(depDate, mins);
    if (now > endDate) {
      await db('trip_instances').where('id', trip.id).update({ status: 'completed' });
      completed++;
    }
  }
  console.log(`Completed ${completed} trips.`);
  await db.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });

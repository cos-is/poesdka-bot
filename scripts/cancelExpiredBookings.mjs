import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import db from '../db/db.mjs'
import { addNotifyJob } from '../queue/notifyQueue.mjs'

async function run() {
  const now = new Date();
  const expired = await db('bookings')
    .where('status','pending')
    .whereNotNull('expires_at')
    .andWhere('expires_at','<', now);
  if (!expired.length) {
    console.log('[cancelExpiredBookings] no expired bookings');
    process.exit(0);
  }
  const ids = expired.map(b=>b.id);
  await db.transaction(async trx => {
    // Вернём места по каждой брони
    for (const b of expired) {
      await trx('trip_instances').where({ id: b.trip_instance_id }).increment('available_seats', b.seats);
    }
    await trx('bookings').whereIn('id', ids).update({ status: 'cancelled' });
    const affected = await trx('bookings')
      .join('users','bookings.user_id','users.id')
      .select('bookings.id as booking_id','users.telegram_id as passenger_tg')
      .whereIn('bookings.id', ids);
    for (const row of affected) {
      if (row.passenger_tg) {
        await addNotifyJob('booking_failed', row.passenger_tg, `Бронирование #${row.booking_id} отменено: истекло время оплаты.`, row.booking_id);
      }
    }
  });
  console.log(`[cancelExpiredBookings] cancelled ${ids.length} bookings (expired): ${ids.join(',')}`);
  process.exit(0);
}

run().catch(e=>{console.error(e);process.exit(1);});

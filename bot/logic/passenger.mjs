import { Markup } from 'telegraf'
import { addBookingJob } from '../../queue/bookingQueue.mjs'
import { addNotifyJob } from '../../queue/notifyQueue.mjs'
import { formatDate, formatTime } from '../../utils/formatDate.mjs'
import { formatPhone } from '../../utils/formatPhone.mjs'
import { showPassengerMenu } from './common.mjs'
import { initYooCheckout, createCommissionPayment, createRefund } from './payments.mjs'

export function passengerLogic(knex) {
  return async (ctx, next) => {
    if (ctx?.session?.user?.role !== 'passenger') {
      next()
      return
    }
    const callbackQuery = ctx?.update?.callback_query
    try {
      // Команда "Найти поездку" (кнопка или текст)
      const message = ctx?.session?.previousMessage || ctx.message
      console.log('passengerLogic', message?.text, callbackQuery?.data, ctx.session.state)
      if ((message && message.text === '🔍 Найти поездку') || (callbackQuery && callbackQuery.data === 'find_trip')) {
        // Получить список городов
        const cities = await knex('cities').orderBy('name', 'asc');
        if (!cities.length) {
          await ctx.reply('Нет доступных городов.');
          return;
        }
        ctx.session.cities = cities;
        ctx.session.state = 'choose_from_city_keyboard';
        ctx.session.from_city_page = 0;
        // Показать города отправления
        const pageSize = 10;
        const showCities = cities.slice(0, pageSize);
        const buttons = showCities.map((c, i) => [{
          text: c.name,
          callback_data: `from_city_${i}`
        }]);
        if (cities.length > pageSize) {
          buttons.push([{ text: 'Далее ▶️', callback_data: 'from_page_1' }]);
        }
        await ctx.reply('Выберите город отправления:', {
          reply_markup: { inline_keyboard: buttons }
        });
        return;
      }
      const data = callbackQuery?.data;

      // ...далее вся логика пассажира на одном уровне...
      // Пример:
      if (ctx.session.state === 'choose_from_city_keyboard' && callbackQuery) {
        const pageSize = 10;
        if (data.startsWith('from_city_')) {
          const idx = parseInt(data.replace('from_city_', ''), 10) + (ctx.session.from_city_page || 0) * pageSize;
          const city = ctx.session.cities && ctx.session.cities[idx];
          if (!city) {
            await ctx.answerCbQuery('Некорректный выбор.');
            return;
          }
          ctx.session.from_city_id = city.id;
          ctx.session.state = 'choose_to_city_keyboard';
          // Выбор города прибытия (исключая выбранный)
          const cities = ctx.session.cities.filter(c => c.id !== city.id);
          const page = 0;
          const totalPages = Math.ceil(cities.length / pageSize);
          const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
          const buttons = showCities.map((c, i) => [{
            text: c.name,
            callback_data: `to_city_${i}`
          }]);
          if (totalPages > 1) {
            buttons.push([{ text: 'Далее ▶️', callback_data: `to_page_${page + 1}` }]);
          }
          ctx.session.to_city_page = 0;
          ctx.session.to_cities = cities;
          await ctx.editMessageText('Выберите город прибытия:', {
            reply_markup: { inline_keyboard: buttons }
          });
          return;
        }
        if (data.startsWith('from_page_')) {
          const page = parseInt(data.replace('from_page_', ''), 10);
          const cities = ctx.session.cities;
          const totalPages = Math.ceil(cities.length / pageSize);
          const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
          const buttons = showCities.map((c, i) => [{
            text: c.name,
            callback_data: `from_city_${i}`
          }]);
          if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `from_page_${page - 1}` }]);
          if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `from_page_${page + 1}` }]);
          ctx.session.from_city_page = page;
          await ctx.editMessageText('Выберите город отправления:', {
            reply_markup: { inline_keyboard: buttons }
          });
          return;
        }
        await ctx.answerCbQuery('Некорректное действие.');
        return;
      }
      // ...остальная логика пассажира...
      // Обработка выбора города прибытия
      if ((ctx.session.state === 'choose_to_city_keyboard') && callbackQuery) {
        const pageSize = 10;
        if (data.startsWith('to_city_')) {
          const idx = parseInt(data.replace('to_city_', ''), 10) + (ctx.session.to_city_page || 0) * pageSize;
          const city = ctx.session.to_cities && ctx.session.to_cities[idx];
          if (!city) {
            await ctx.answerCbQuery('Некорректный выбор.');
            return;
          }
          ctx.session.to_city_id = city.id;
          ctx.session.state = 'search_date_choice';
          // Кнопки быстрых дат и календарь
          const replyCalendarMsg = await ctx.editMessageText('Выберите дату:', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Сегодня', callback_data: 'date_today' },
                  { text: 'Завтра', callback_data: 'date_tomorrow' },
                  { text: 'Послезавтра', callback_data: 'date_aftertomorrow' }
                ],
                [
                  { text: 'Указать дату 📅', callback_data: 'search_date_calendar' }
                ]
              ]
            }
          });
          ctx.session.calendarReply = {
            messageId: replyCalendarMsg.message_id,
            chatId: replyCalendarMsg.chat.id,
          };
          return;
        }
        if (data.startsWith('to_page_')) {
          const page = parseInt(data.replace('to_page_', ''), 10);
          const cities = ctx.session.to_cities;
          const totalPages = Math.ceil(cities.length / pageSize);
          const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
          const buttons = showCities.map((c, i) => [{
            text: c.name,
            callback_data: `to_city_${i}`
          }]);
          if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `to_page_${page - 1}` }]);
          if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `to_page_${page + 1}` }]);
          ctx.session.to_city_page = page;
          await ctx.editMessageText('Выберите город прибытия:', {
            reply_markup: { inline_keyboard: buttons }
          });
          return;
        }
        await ctx.answerCbQuery('Некорректное действие.');
        return;
      }

      // Главное меню пассажира через инлайн-кнопки
      if ((message && message.text === 'Меню пассажира') || data === 'passenger_menu') {
        await showPassengerMenu(ctx)
        ctx.session.state = null;
        if (callbackQuery) await ctx.answerCbQuery();
        return;
      }

      // Переход к активным бронированиям
      console.log('user', ctx.session.user.telegram_id)
      if (message?.text === 'Мои бронирования' || callbackQuery?.data === 'my_bookings') {
        const bookings = await knex('bookings')
          .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
          .join('trips', 'trip_instances.trip_id', 'trips.id')
          .join('cities as dep', 'trips.departure_city_id', 'dep.id')
          .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
          .join('users as drivers', 'trips.driver_id', 'drivers.id')
          .leftJoin('cars', 'trips.car_id', 'cars.id')
          .where('bookings.user_id', ctx.session.user.id)
          .andWhere('bookings.status', 'active')
          .andWhere('trip_instances.status', 'active')
          .select(
            'bookings.id as booking_id',
            'trip_instances.departure_date',
            'trip_instances.departure_time',
            'dep.name as departure_city',
            'arr.name as arrival_city',
            'bookings.seats',
            'trip_instances.price as price',
            'drivers.name as driver_name',
            'drivers.phone as driver_phone',
            'cars.brand as car_brand',
            'cars.model as car_model',
            'cars.color as car_color',
            'cars.license_plate as car_plate',
            'cars.photo_url as car_photo_url'
          )
          .orderBy('trip_instances.departure_date', 'asc');
          console.log('bookings', bookings)
        if (!bookings.length) {
          await ctx.reply('У вас нет активных бронирований.');
          return;
        }
        // Список бронирований с кнопками для детализации
        const page = 0;
        const pageSize = 10;
        const totalPages = Math.ceil(bookings.length / pageSize);
        const showBookings = bookings.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showBookings.map((b, i) => [{
          text: `${formatDate(b.departure_date)} ${formatTime(b.departure_time)} | ${b.departure_city} → ${b.arrival_city}`,
          callback_data: `show_booking_${i}`
        }]);
        if (totalPages > 1) {
          buttons.push([
            { text: 'Далее ▶️', callback_data: `booking_page_${page + 1}` }
          ]);
        }
        ctx.session.bookings = bookings;
        ctx.session.booking_page = 0;
        ctx.session.state = 'show_booking_list';
        await ctx.reply('Ваши активные бронирования:', {
          reply_markup: { inline_keyboard: buttons.concat([[{ text: 'Назад', callback_data: 'passenger_menu' }]]) }
        });
        // await ctx.answerCbQuery();
        return;
      }

      // История поездок
      if (callbackQuery && callbackQuery.data === 'trip_history') {
        const history = await knex('bookings')
            .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
            .join('trips', 'trip_instances.trip_id', 'trips.id')
            .join('cities as dep', 'trips.departure_city_id', 'dep.id')
            .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
            .join('users as drivers', 'trips.driver_id', 'drivers.id')
            .leftJoin('cars', 'trips.car_id', 'cars.id')
            .where('bookings.user_id', ctx.from.id)
            .andWhere(function() {
              this.where('bookings.status', 'cancelled').orWhere('trip_instances.status', 'completed');
            })
            .select(
              'trip_instances.departure_date',
              'trip_instances.departure_time',
              'dep.name as departure_city',
              'arr.name as arrival_city',
              'bookings.seats',
              'trip_instances.price as price',
              'drivers.name as driver_name',
              'drivers.phone as driver_phone',
              'bookings.status as booking_status',
              'trip_instances.status as trip_status',
              'cars.brand as car_brand',
              'cars.model as car_model',
              'cars.color as car_color',
              'cars.license_plate as car_plate',
              'cars.photo_url as car_photo_url'
            )
            .orderBy('trip_instances.departure_date', 'desc')
            .limit(10);
          if (!history.length) {
            await ctx.reply('История пуста.');
            return;
          }
          let msg = 'История поездок:';
          for (let i = 0; i < history.length; i++) {
            const b = history[i];
            let carInfo = '';
            if (b.car_brand || b.car_model || b.car_plate) {
              carInfo = `\nАвто: ${b.car_brand || ''} ${b.car_model || ''}\nЦвет: ${b.car_color || '-'}\nНомер: ${b.car_plate || '-'}\n`;
            }
            if (b.car_photo_url) {
              await ctx.replyWithPhoto(b.car_photo_url, { caption: `Авто для поездки: ${b.car_brand || ''} ${b.car_model || ''}` });
            }
            msg += `\n\n${i + 1}. ${formatDate(b.departure_date)} ${formatTime(b.departure_time)}\nМаршрут: ${b.departure_city} → ${b.arrival_city}\nВодитель: ${b.driver_name} (${b.driver_phone})${carInfo}Мест: ${b.seats}\nЦена: ${b.price}₽\nСтатус: ${b.booking_status === 'cancelled' ? 'Отменено' : 'Завершено'}`;
          }
        await ctx.reply(msg, {
          reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'passenger_menu' }]] }
        });
        ctx.session.state = null;
        await ctx.answerCbQuery();
        return;
      }

      // Обработка показа деталей бронирования и пагинации
      if (ctx.session.state === 'show_booking_list' && callbackQuery) {
        const pageSize = 10;
        if (data.startsWith('show_booking_')) {
          const idx = parseInt(data.replace('show_booking_', ''), 10) + (ctx.session.booking_page || 0) * pageSize;
          const booking = ctx.session.bookings && ctx.session.bookings[idx];
          if (!booking) {
            await ctx.answerCbQuery('Некорректный выбор.');
            return;
          }
          ctx.session.selected_booking = booking;
          let carInfo = '';
          if (booking.car_brand || booking.car_model || booking.car_plate) {
            carInfo = `\nАвто: ${booking.car_brand || ''} ${booking.car_model || ''}\nЦвет: ${booking.car_color || '-'}\nНомер: ${booking.car_plate || '-'}\n`;
          }
          if (booking.car_photo_url) {
            await ctx.replyWithPhoto(booking.car_photo_url, { caption: `Авто для поездки: ${booking.car_brand || ''} ${booking.car_model || ''}` });
          }
          let driverContact = booking.driver_phone ? `\nТелефон водителя: ${formatPhone(booking.driver_phone)}` : '';
          let msg = `Бронирование:\nДата: ${formatDate(booking.departure_date)} ${formatTime(booking.departure_time)}\nМаршрут: ${booking.departure_city} → ${booking.arrival_city}\nВодитель: ${booking.driver_name}${driverContact}${carInfo}Мест: ${booking.seats}\nЦена: ${booking.price}₽`;
          await ctx.reply(msg, {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Отменить бронирование', callback_data: 'cancel_booking_confirm' }],
                [{ text: 'Назад к списку', callback_data: 'back_to_booking_list' }]
              ]
            }
          });
          await ctx.answerCbQuery();
          return;
        }
        if (data === 'cancel_booking_confirm') {
          await ctx.reply('Вы уверены, что хотите отменить бронирование? Это действие нельзя отменить.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Да', callback_data: 'cancel_booking_final' }],
                [{ text: 'Нет', callback_data: 'show_booking_0' }]
              ]
            }
          });
          await ctx.answerCbQuery();
          return;
        }
        if (data === 'cancel_booking_final') {
          const booking = ctx.session.selected_booking;
          if (!booking) {
            await ctx.reply('Бронирование не найдено.');
            return;
          }
          // Получить trip_instance_id через отдельный запрос, если его нет
          let tripInstanceId = booking.trip_instance_id;
          if (!tripInstanceId) {
            const bookingRow = await knex('bookings').where({ id: booking.booking_id }).first();
            tripInstanceId = bookingRow?.trip_instance_id;
          }
          // Отмена бронирования, восстановление мест
          await knex.transaction(async trx => {
            await trx('bookings').where({ id: booking.booking_id }).update({ status: 'cancelled' });
            await trx('trip_instances').where({ id: tripInstanceId }).increment('available_seats', booking.seats);
          });
          // Если была оплата, оформим возврат комиссии автоматически
          const fullBooking = await knex('bookings').where({ id: booking.booking_id }).first();
          if (fullBooking?.payment_id) {
            const pay = await knex('payments').where({ id: fullBooking.payment_id }).first();
            if (pay && pay.status === 'succeeded' && pay.provider_payment_id) {
              const yc = initYooCheckout();
              if (yc) {
                try {
                  const idemp = `refund-booking-${booking.booking_id}-${Date.now()}`;
                  const refund = await createRefund(yc, {
                    providerPaymentId: pay.provider_payment_id,
                    amount: pay.amount,
                    description: `Возврат комиссии за отмену брони #${booking.booking_id}`,
                    idempotenceKey: idemp,
                  });
                  // Опционально сохраняем реестр возвратов (в таблице payments.raw уже есть история, можно не хранить отдельно)
                  await knex('payments').where({ id: fullBooking.payment_id }).update({ raw: JSON.stringify({ ...(pay.raw || {}), refund }) });
                  // Запишем в refunds
                  try {
                    await knex('refunds').insert({
                      payment_id: fullBooking.payment_id,
                      booking_id: booking.booking_id,
                      provider_refund_id: refund?.id || null,
                      amount: pay.amount,
                      currency: pay.currency || 'RUB',
                      status: refund?.status || 'created',
                      raw: JSON.stringify(refund || {})
                    });
                  } catch { /* ignore */ }
                  // Уведомление пассажиру о возврате комиссии
                  await ctx.reply(`Возврат комиссии оформлен (${pay.amount}₽). Средства вернутся на карту в течение 1–7 дней (в зависимости от банка).`);
                } catch (e) {
                  console.error('Ошибка возврата комиссии', e.message);
                }
              }
            }
          }
          // Уведомление водителю
          const driver = await knex('users')
            .join('trips', 'users.id', 'trips.driver_id')
            .join('trip_instances', 'trips.id', 'trip_instances.trip_id')
            .where('trip_instances.id', tripInstanceId)
            .select('users.telegram_id', 'users.name')
            .first();
          if (driver) {
            await addNotifyJob(
              'booking_cancelled',
              driver.telegram_id,
              `Пассажир отменил бронирование на поездку ${booking.departure_city} → ${booking.arrival_city} (${formatDate(booking.departure_date)} ${formatTime(booking.departure_time)}).`,
              booking.booking_id
            );
          }
          await ctx.reply('Бронирование отменено.');
          ctx.session.selected_booking = null;
          // Вернуться к списку
          ctx.session.state = 'show_booking_list';
          // ...existing code to show booking list...
          return;
        }
        if (data.startsWith('booking_page_')) {
          const page = parseInt(data.replace('booking_page_', ''), 10);
          const bookings = ctx.session.bookings;
          const totalPages = Math.ceil(bookings.length / pageSize);
          const showBookings = bookings.slice(page * pageSize, (page + 1) * pageSize);
          const buttons = showBookings.map((b, i) => [{
            text: `${formatDate(b.departure_date)} ${formatTime(b.departure_time)} | ${b.departure_city} → ${b.arrival_city}`,
            callback_data: `show_booking_${i}`
          }]);
          if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `booking_page_${page - 1}` }]);
          if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `booking_page_${page + 1}` }]);
          ctx.session.booking_page = page;
          await ctx.editMessageText('Ваши активные бронирования:', {
            reply_markup: { inline_keyboard: buttons.concat([[{ text: 'Назад', callback_data: 'passenger_menu' }]]) }
          });
          await ctx.answerCbQuery();
          return;
        }
        if (data === 'back_to_booking_list') {
          // Вернуться к списку
          const page = ctx.session.booking_page || 0;
          const bookings = ctx.session.bookings;
          const totalPages = Math.ceil(bookings.length / pageSize);
          const showBookings = bookings.slice(page * pageSize, (page + 1) * pageSize);
          const buttons = showBookings.map((b, i) => [{
            text: `${formatDate(b.departure_date)} ${formatTime(b.departure_time)} | ${b.departure_city} → ${b.arrival_city}`,
            callback_data: `show_booking_${i}`
          }]);
          if (totalPages > 1) {
            buttons.push([{ text: 'Далее ▶️', callback_data: `booking_page_${page + 1}` }]);
          }
          await ctx.reply('Ваши активные бронирования:', {
            reply_markup: { inline_keyboard: buttons.concat([[{ text: 'Назад', callback_data: 'passenger_menu' }]]) }
          });
          await ctx.answerCbQuery();
          return;
        }
        await ctx.answerCbQuery('Некорректное действие.');
        return;
      }

      // Обработка выбора даты через кнопки
      if (ctx.session.state === 'search_date_choice' && callbackQuery) {
        let date;
        if (callbackQuery.data === 'date_today') {
          date = new Date();
        } else if (callbackQuery.data === 'date_tomorrow') {
          date = new Date(); date.setDate(date.getDate() + 1);
        } else if (callbackQuery.data === 'date_aftertomorrow') {
          date = new Date(); date.setDate(date.getDate() + 2);
        }
        if (date) {
          ctx.session.date = date.toISOString().slice(0, 10);
          ctx.session.state = 'search_date';
          await ctx.answerCbQuery();
          await ctx.reply('Дата выбрана: ' + formatDate(ctx.session.date));
          // Переход к поиску поездок
          // ...existing code...
        }
      }

      if (ctx.session.state === 'search_date') {
        // Поиск поездок по id городов
        const trips = await knex('trip_instances')
          .join('trips', 'trip_instances.trip_id', 'trips.id')
          .where({
            'trips.departure_city_id': ctx.session.from_city_id,
            'trips.arrival_city_id': ctx.session.to_city_id,
            'trip_instances.departure_date': ctx.session.date,
            'trip_instances.status': 'active'
          })
          .andWhere('trip_instances.available_seats', '>', 0)
          .select('trip_instances.id', 'trip_instances.departure_time', 'trip_instances.price', 'trip_instances.available_seats', 'trips.seats');
        if (trips.length === 0) {
          await ctx.reply('Поездок не найдено. Попробуйте изменить параметры поиска.');
          ctx.session.state = null;
          return;
        }
        let msg = 'Доступные поездки:';
        const buttons = trips.map((t, i) => [{
          text: `${formatTime(t.departure_time)} | ${t.price}₽ | мест: ${t.available_seats}/${t.seats}`,
          callback_data: `choose_trip_${i}`
        }]);
        trips.forEach((t, i) => {
          msg += `\n${i + 1}. Время: ${formatTime(t.departure_time)}, Цена: ${t.price}₽, Мест: ${t.available_seats}/${t.seats}`;
        });
        await ctx.reply(msg, {
          reply_markup: {
            inline_keyboard: buttons
          }
        });
        ctx.session.trips = trips;
        ctx.session.state = 'choose_trip_keyboard';
        return;
      }
      // Выбор поездки через инлайн-клавиатуру
      if (ctx.session.state === 'choose_trip_keyboard' && callbackQuery && callbackQuery.data.startsWith('choose_trip_')) {
        const idx = parseInt(callbackQuery.data.replace('choose_trip_', ''), 10);
        const trip = ctx.session.trips && ctx.session.trips[idx];
        if (!trip) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        // Получить подробную информацию о поездке
        const tripDetails = await knex('trip_instances')
          .join('trips', 'trip_instances.trip_id', 'trips.id')
          .join('users as drivers', 'trips.driver_id', 'drivers.id')
          .leftJoin('cars', 'trips.car_id', 'cars.id')
          .join('cities as dep', 'trips.departure_city_id', 'dep.id')
          .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
          .where('trip_instances.id', trip.id)
          .select(
            'trip_instances.id',
            'trip_instances.departure_time',
            'trip_instances.price',
            'trip_instances.available_seats',
            'trip_instances.duration',
            'trip_instances.departure_address',
            'trip_instances.arrival_address',
            'trip_instances.comment',
            'trips.seats',
            'dep.name as departure_city',
            'arr.name as arrival_city',
            'drivers.name as driver_name',
            'cars.brand as car_brand',
            'cars.model as car_model',
            'cars.color as car_color',
            'cars.license_plate as car_plate',
            'cars.photo_url as car_photo_url'
          )
          .first();
        ctx.session.selected_trip = trip;
        ctx.session.selected_trip_details = tripDetails;
        ctx.session.state = 'trip_summary';
        // Формируем сообщение с деталями
        let carInfo = '';
        if (tripDetails.car_brand || tripDetails.car_model || tripDetails.car_plate) {
          carInfo = `\nАвто: ${tripDetails.car_brand || ''} ${tripDetails.car_model || ''}\nЦвет: ${tripDetails.car_color || '-'}\nНомер: ${tripDetails.car_plate || '-'}\n`;
        }
  let durationInfo = tripDetails.duration ? `\nВ пути: ${tripDetails.duration} мин.` : '';
  let addressInfo = `\nАдрес отправления: ${tripDetails.departure_address || '-'}\nАдрес прибытия: ${tripDetails.arrival_address || '-'}`;
  let commentInfo = tripDetails.comment ? `\nКомментарий: ${tripDetails.comment}` : '';
  let msg = `Поездка:\nВремя: ${formatTime(tripDetails.departure_time)}\nМаршрут: ${tripDetails.departure_city} → ${tripDetails.arrival_city}${addressInfo}${commentInfo}\nВодитель: ${tripDetails.driver_name}${carInfo}Мест доступно: ${tripDetails.available_seats}/${tripDetails.seats}\nЦена: ${tripDetails.price}₽${durationInfo}`;
        // Показываем фото авто, если есть
        // if (tripDetails.car_photo_url) {
        //   await ctx.replyWithPhoto(tripDetails.car_photo_url, { caption: `Авто для поездки: ${tripDetails.car_brand || ''} ${tripDetails.car_model || ''}` });
        // }
        await ctx.editMessageText(msg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Забронировать', callback_data: 'book_selected_trip' },
                { text: 'Назад', callback_data: 'back_to_trip_list' }
              ]
            ]
          }
        });
        await ctx.answerCbQuery();
        return;
      }
      // Обработка кнопок после показа информации о поездке
      if (ctx.session.state === 'trip_summary' && callbackQuery) {
        if (callbackQuery.data === 'book_selected_trip') {
          ctx.session.state = 'choose_seats';
          await ctx.editMessageReplyMarkup(); // Убираем кнопки
          await ctx.reply('Сколько мест забронировать?');
          await ctx.answerCbQuery();
          return;
        }
        if (callbackQuery.data === 'back_to_trip_list') {
          // Вернуться к списку поездок
          ctx.session.state = 'choose_trip_keyboard';
          // Повторно показать список поездок
          const trips = ctx.session.trips || [];
          let msg = 'Доступные поездки:';
          const buttons = trips.map((t, i) => [{
            text: `${formatTime(t.departure_time)} | ${t.price}₽ | мест: ${t.available_seats}/${t.seats}`,
            callback_data: `choose_trip_${i}`
          }]);
          trips.forEach((t, i) => {
            msg += `\n${i + 1}. Время: ${formatTime(t.departure_time)}, Цена: ${t.price}₽, Мест: ${t.available_seats}/${t.seats}`;
          });
          await ctx.editMessageText(msg, {
            reply_markup: {
              inline_keyboard: buttons
            }
          });
          await ctx.answerCbQuery();
          return;
        }
      }
      if ((ctx.session.state === 'choose_seats' && message && message.text) || ctx?.session.state === 'awaiting_phone' || ctx?.session.state === 'awaiting_phone_input' || ctx?.session.state === 'awaiting_phone_choice') {
        if (!ctx?.session.seats) {
          ctx.session.seats = parseInt(message.text, 10);
        }
        const seats = ctx.session.seats;
        const available = ctx.session.selected_trip?.available_seats;
        if (!seats || seats < 1 || (available && seats > available && seats !== available)) {
          await ctx.reply(`Введите корректное число мест (от 1 до ${available || 'доступно'}).`);
          return;
        }
        console.log('user phone', ctx.session?.user)
        if (!ctx.session?.user?.phone && !ctx?.message?.contact) {
          // Если не запрошен способ, предлагаем выбор
          if (ctx.session.state !== 'awaiting_phone_input' && ctx.session.state !== 'awaiting_phone_choice') {
            ctx.reply('Пожалуйста, выберите способ указания номера телефона:', {
              reply_markup: {
                keyboard: [
                  [
                    { text: 'Ввести номер вручную' },
                    Markup.button.contactRequest('Прикрепить телефон')
                  ]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
              }
            });
            ctx.session.state = 'awaiting_phone_choice';
            return;
          }
        }
        // Если пользователь выбрал ввод вручную
        if (ctx.session.state === 'awaiting_phone_choice' && ctx.message && ctx.message.text === 'Ввести номер вручную') {
          await ctx.reply('Пожалуйста, введите номер телефона в формате +79991234567:');
          ctx.session.state = 'awaiting_phone_input';
          return;
        }
        // Если пользователь прислал контакт
        if (ctx?.message?.contact) {
          let raw = ctx.message.contact.phone_number.trim();
          raw = raw.replace(/[^+\d]/g,'');
          if (raw.startsWith('8')) raw = '+7' + raw.slice(1);
          if (/^7\d{10}$/.test(raw)) raw = '+' + raw; // 7XXXXXXXXXX -> +7XXXXXXXXXX
          ctx.session.user.phone = raw;
          await knex('users').where({ telegram_id: ctx.from.id }).update({ phone: raw });
          await ctx.reply('Телефон сохранён.', { reply_markup: { remove_keyboard: true } });
        }
        // Если пользователь вводит телефон вручную
        if (ctx.session.state === 'awaiting_phone_input' && ctx.message && ctx.message.text) {
          let phone = ctx.message.text.trim();
          phone = phone.replace(/[^+\d]/g,'');
          if (phone.startsWith('8')) phone = '+7' + phone.slice(1);
          if (/^7\d{10}$/.test(phone)) phone = '+' + phone;
          if (!/^\+7\d{10}$/ .test(phone)) {
            await ctx.reply('Пожалуйста, введите корректный номер в формате +79991234567.');
            return;
          }
          ctx.session.user.phone = phone;
          await knex('users').where({ telegram_id: ctx.from.id }).update({ phone });
          await ctx.reply('Телефон сохранён.', { reply_markup: { remove_keyboard: true } });
          ctx.session.state = null;
        }
        // Добавить задачу в очередь бронирований
        try {
          const tripInstanceId = ctx.session.selected_trip.id;
          const seats = ctx.session.seats;
          const user = await knex('users').where({ telegram_id: ctx.from.id }).first();
          if (!user) throw new Error('Пользователь не найден');
          const userId = user.id;
          // Проверка на существующую активную или ожидающую оплату бронь
          const existingBooking = await knex('bookings')
            .where({ trip_instance_id: tripInstanceId, user_id: userId })
            .whereIn('status', ['active','pending','awaiting_confirmation'])
            .first();
          if (existingBooking) {
            await ctx.reply('У вас уже есть бронирование этой поездки (активное или в ожидании оплаты).');
            return;
          }
          // Резервируем места и создаём pending booking атомарно
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 минут на оплату
          const bookingId = await knex.transaction(async trx => {
            const affected = await trx('trip_instances')
              .where({ id: tripInstanceId })
              .andWhere('available_seats','>=', seats)
              .decrement('available_seats', seats);
            if (!affected) throw new Error('NO_SEATS');
            const [id] = await trx('bookings').insert({ trip_instance_id: tripInstanceId, user_id: userId, seats, status: 'pending', expires_at: expiresAt });
            return id;
          }).catch(err => {
            if (err && err.message === 'NO_SEATS') return null;
            throw err;
          });
          if (!bookingId) {
            await ctx.reply('Недостаточно мест. Обновите список поездок.');
            return;
          }
          // Фиксированная комиссия: 50₽ за место (можно задать COMMISSION_PER_SEAT)
          const COMMISSION_PER_SEAT = parseInt(process.env.COMMISSION_PER_SEAT || '50', 10);
          const commissionAmount = COMMISSION_PER_SEAT * seats;
          const yoo = initYooCheckout();
          let paymentUrl;
          if (yoo) {
            try {
              const idempotenceKey = `booking-${bookingId}-${Date.now()}`;
              const payment = await createCommissionPayment(yoo, {
                amount: commissionAmount,
                description: `Комиссия за бронирование #${bookingId}`,
                metadata: { booking_id: bookingId, user_id: userId, trip_instance_id: tripInstanceId, return_url: 'https://t.me/' + ctx.botInfo?.username },
                idempotenceKey
              });
              paymentUrl = payment?.confirmation?.confirmation_url;
              // Сохраняем payment
              const [paymentId] = await knex('payments').insert({ provider: 'yookassa', provider_payment_id: payment.id, amount: commissionAmount, currency: 'RUB', status: payment.status, description: `Комиссия за бронирование #${bookingId}`, idempotence_key: idempotenceKey });
              await knex('bookings').where({ id: bookingId }).update({ payment_id: paymentId });
            } catch (err) {
              console.error('Ошибка создания платежа', err);
            }
          }
          if (paymentUrl) {
            const minutesLeft = 15; // фиксировано пока
            await ctx.reply(
              `Бронирование #${bookingId} создано и ожидает оплаты комиссии.
Места: ${seats}
Комиссия: ${commissionAmount}₽ (по ${COMMISSION_PER_SEAT}₽ за место)`,
              {
                reply_markup: {
                  inline_keyboard: [[{ text: 'Оплатить', url: paymentUrl }]]
                }
              }
            );
          } else {
            await ctx.reply('Бронирование создано. Оплата временно недоступна, свяжитесь с поддержкой.');
          }
          await showPassengerMenu(ctx);
        } catch (e) {
          console.log(e);
          await ctx.reply('Ошибка создания бронирования. Попробуйте позже.');
        }
        ctx.session.state = null;
        ctx.session.trips = null;
        ctx.session.selected_trip = null;
        return;
      }
      // Обработка нераспознанных команд
      if (message && message.text) {
        await ctx.reply('Не удалось распознать команду. Используйте меню или введите /start для сброса.');
        return;
      }
      await next();
    } catch (error) {
      console.error('Error in passengerLogic:', error);
      await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
      return;
    }
  }
}

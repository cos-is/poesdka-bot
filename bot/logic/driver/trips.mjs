import { Markup } from 'telegraf'
import { formatDate, formatTime, getDate } from "../../../utils/formatDate.mjs";
import { addNotifyJob } from '../../../queue/notifyQueue.mjs';
import { showDriverMenu } from '../common.mjs'
import { formatPhone } from '../../../utils/formatPhone.mjs'
import { initYooCheckout, createRefund } from '../../logic/payments.mjs'

// Логика создания, редактирования и просмотра поездок

const editTripKeyboard = [
  [{ text: "Пассажиры", callback_data: "show_passengers" }],
  [{ text: "Кол-во свободных мест", callback_data: "edit_available_seats" }],
  [{ text: "Кол-во мест", callback_data: "edit_seats" }],
  [{ text: "Цена", callback_data: "edit_price" }],
  [{ text: "Способ оплаты", callback_data: "edit_payment_method" }],
  [{ text: "Адрес отправления", callback_data: "edit_departure_address" }],
  [{ text: "Адрес прибытия", callback_data: "edit_arrival_address" }],
  [{ text: "Комментарий", callback_data: "edit_comment" }],
  [{ text: "Авто", callback_data: "edit_car" }],
  [{ text: "Завершить поездку", callback_data: "complete_trip" }],
  [{ text: "Отменить поездку", callback_data: "cancel_trip" }],
  [{ text: "Назад", callback_data: "back_to_trips" }],
];
// console.log("edit trip keyboard", editTripKeyboard);


export async function handleDriverTrips(ctx, next, knex) {
  console.log('TRIPS')
  const callbackQuery = ctx?.update?.callback_query;
  const message = ctx.message;
  // --- Обработка подтверждения/отклонения бронирования водителем ---
  if (callbackQuery && callbackQuery.data) {
    const data = callbackQuery.data;
    if (data.startsWith('driver_confirm_booking_')) {
      const bookingId = data.replace('driver_confirm_booking_', '');
      // Получаем бронь
      const bookingRow = await knex('bookings').where({ id: bookingId }).first();
      if (!bookingRow) { await ctx.answerCbQuery('Бронь не найдена'); return true; }
      // Транзакционно уменьшаем места и активируем бронь
      await knex.transaction(async trx => {
        await trx('bookings').where({ id: bookingRow.id }).update({ status: 'active', confirmed: true });
        return true;
      });
      // Получить telegram_id пассажира и детали поездки, включая фото авто
      const booking = await knex('bookings')
        .join('users as passenger', 'bookings.user_id', 'passenger.id')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .join('trips', 'trip_instances.trip_id', 'trips.id')
        .join('users as driver', 'trips.driver_id', 'driver.id')
        .leftJoin('cars', 'trips.car_id', 'cars.id')
        .join('cities as dep', 'trips.departure_city_id', 'dep.id')
        .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
        .select(
          'passenger.telegram_id as passenger_telegram_id',
          'passenger.name as passenger_name',
          'passenger.phone as passenger_phone',
          'dep.name as departure_city',
          'arr.name as arrival_city',
          'trip_instances.departure_date',
          'trip_instances.departure_time',
          'trip_instances.departure_address',
          'trip_instances.arrival_address',
          'trip_instances.comment as trip_comment',
          'driver.name as driver_name',
          'driver.phone as driver_phone',
          'cars.brand as car_brand',
          'cars.model as car_model',
          'cars.license_plate as car_license_plate',
          'cars.photo_url as car_photo_url'
        )
        .where('bookings.id', bookingId)
        .first();
      if (booking && booking.passenger_telegram_id) {
        const notifyMsg =
          `Ваша бронь подтверждена!\n` +
          `Поездка: ${booking.departure_city} → ${booking.arrival_city}\n` +
          `Дата: ${formatDate(booking.departure_date)}, время: ${formatTime(booking.departure_time)}\n` +
          `Адрес отправления: ${booking.departure_address || '-'}\n` +
          `Адрес прибытия: ${booking.arrival_address || '-'}\n` +
          (booking.trip_comment ? `Комментарий: ${booking.trip_comment}\n` : '') +
          `\nВодитель: ${booking.driver_name || '-'}\nТелефон: ${formatPhone(booking.driver_phone) || '-'}\n` +
          `Авто: ${booking.car_brand || ''} ${booking.car_model || ''} (${booking.car_license_plate || ''})`;
        // Отправляем фото авто, если есть
        try {
          if (booking.car_photo_url && ctx.telegram) {
            await ctx.telegram.sendPhoto(
              booking.passenger_telegram_id,
              booking.car_photo_url,
              { caption: `Авто для поездки: ${booking.car_brand || ''} ${booking.car_model || ''}` }
            );
          }
        } catch (e) { /* ignore */ }
        await addNotifyJob('booking_confirmed', booking.passenger_telegram_id, notifyMsg);
        // Редактируем исходное сообщение с кнопками, чтобы исключить повторное действие
        const editText =
          `Бронь подтверждена\n\n` +
          `Пассажир: ${booking.passenger_name || '-'} (${formatPhone(booking.passenger_phone) || '-'})\n` +
          `Маршрут: ${booking.departure_city} → ${booking.arrival_city}\n` +
          `Дата: ${formatDate(booking.departure_date)}, время: ${formatTime(booking.departure_time)}\n` +
          `Мест: ${bookingRow.seats}`;
        try {
          await ctx.editMessageText(editText, { reply_markup: { inline_keyboard: [] } });
        } catch (e) { /* ignore */ }
      }
      await ctx.answerCbQuery('Бронирование подтверждено');
      return true;
    }
    if (data.startsWith('driver_reject_booking_')) {
      const bookingId = data.replace('driver_reject_booking_', '');
      // Вернём места и отменим бронь
      const b = await knex('bookings').where({ id: bookingId }).first();
      if (b) {
        await knex.transaction(async trx => {
          await trx('trip_instances').where({ id: b.trip_instance_id }).increment('available_seats', b.seats);
          await trx('bookings').where({ id: bookingId }).update({ status: 'cancelled', confirmed: false });
        });
        // Автовозврат комиссии
        if (b.payment_id) {
          const pay = await knex('payments').where({ id: b.payment_id }).first();
          if (pay && pay.status === 'succeeded' && pay.provider_payment_id) {
            const yc = initYooCheckout();
            if (yc) {
              try {
                const idemp = `refund-booking-${bookingId}-${Date.now()}`;
                const refund = await createRefund(yc, {
                  providerPaymentId: pay.provider_payment_id,
                  amount: pay.amount,
                  description: `Возврат комиссии: отклонена бронь #${bookingId}`,
                  idempotenceKey: idemp,
                });
                await knex('payments').where({ id: b.payment_id }).update({ raw: JSON.stringify({ ...(pay.raw || {}), refund }) });
                try {
                  await knex('refunds').insert({
                    payment_id: b.payment_id,
                    booking_id: bookingId,
                    provider_refund_id: refund?.id || null,
                    amount: pay.amount,
                    currency: pay.currency || 'RUB',
                    status: refund?.status || 'created',
                    raw: JSON.stringify(refund || {})
                  });
                } catch {}
                // Уведомление пассажиру о возврате комиссии
                const passenger = await knex('users').where({ id: b.user_id }).first();
                if (passenger?.telegram_id) {
                  await addNotifyJob('booking_refund', passenger.telegram_id, `Возврат комиссии оформлен (${pay.amount}₽) по отменённой брони #${bookingId}. Средства вернутся в течение 1–7 дней.`);
                }
              } catch (e) { console.error('Ошибка возврата комиссии', e.message); }
            }
          }
        }
      } else {
        await knex('bookings').where({ id: bookingId }).update({ status: 'cancelled', confirmed: false });
      }
      // Получить telegram_id пассажира и детали поездки
      const booking = await knex('bookings')
        .join('users', 'bookings.user_id', 'users.id')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .join('trips', 'trip_instances.trip_id', 'trips.id')
        .join('cities as dep', 'trips.departure_city_id', 'dep.id')
        .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
        .select('users.telegram_id as passenger_telegram_id', 'dep.name as departure_city', 'arr.name as arrival_city', 'trip_instances.departure_date', 'trip_instances.departure_time')
        .where('bookings.id', bookingId)
        .first();
      if (booking && booking.passenger_telegram_id) {
        await addNotifyJob(
          'booking_rejected',
          booking.passenger_telegram_id,
          `Ваша бронь отклонена водителем. Поездка: ${booking.departure_city} → ${booking.arrival_city}, дата: ${formatDate(booking.departure_date)}, время: ${formatTime(booking.departure_time)}`
        );
      }
      // Редактируем исходное сообщение с кнопками
      try {
        await ctx.editMessageText('Бронирование отклонено', { reply_markup: { inline_keyboard: [] } });
      } catch (e) { /* ignore */ }
      await ctx.answerCbQuery('Бронирование отклонено');
      return true;
    }
  }
  // --- Создание новой поездки ---
  if (message && message.text === "Создать новую поездку") {
    // Показываем только кнопку отмены
    await ctx.reply('Создание новой поездки.', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    // Проверяем наличие предыдущих поездок
    let prevTrips = await knex("trips")
      .join("cities as dep", "trips.departure_city_id", "dep.id")
      .join("cities as arr", "trips.arrival_city_id", "arr.id")
      .where("trips.driver_id", ctx.session.user.id)
      .select("trips.*",
        "dep.name as departure_city",
        "arr.name as arrival_city"
      )
      .orderBy("created_at", "desc");
    // Фильтрация по уникальным парам городов
    const uniquePairs = new Set();
    prevTrips = prevTrips.filter(t => {
      const key = `${t.departure_city}_${t.arrival_city}`;
      if (uniquePairs.has(key)) return false;
      uniquePairs.add(key);
      return true;
    });
    if (prevTrips.length) {
      const buttons = prevTrips.slice(0, 5).map((t, i) => [
        {
          text: `${t.departure_city} → ${t.arrival_city}`,
          callback_data: `reuse_trip_${t.id}`,
        },
      ]);
      buttons.push([
        { text: "Создать новую поездку", callback_data: "create_new_trip" },
      ]);
      await ctx.reply(
        "Опубликуйте снова одну из ранее созданных поездок или создайте новую.",
        {
          reply_markup: { inline_keyboard: buttons },
        }
      );
      ctx.session.state = "choose_trip_reuse_or_new";
      ctx.session.prevTrips = prevTrips;
      return true;
    }
    // Если нет предыдущих — сразу создаём новую
    ctx.session.state = "create_new_trip";
  }

  // --- Выбор: использовать существующую поездку или создать новую ---
  if (ctx.session.state === "choose_trip_reuse_or_new" && callbackQuery) {
    const data = callbackQuery.data;
    if (data.startsWith("reuse_trip_")) {
      const tripId = parseInt(data.replace("reuse_trip_", ""));
      const trip = ctx.session.prevTrips.find((t) => t.id === tripId);
      if (!trip) {
        await ctx.answerCbQuery("Некорректный выбор.");
        return true;
      }
      ctx.session.selected_trip = trip;
      // Переходим к созданию нового инстанса для этой поездки
      ctx.session.state = "create_trip_instance_for_existing";
      // console.log(trip)
      const msg = await ctx.reply("Выберите дату поездки:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Сегодня", callback_data: "date_today" },
              { text: "Завтра", callback_data: "date_tomorrow" },
              { text: "Послезавтра", callback_data: "date_aftertomorrow" },
            ],
            [
              {
                text: "Указать дату 📅",
                callback_data: "create_trip_date_for_existing",
              },
            ],
          ],
        },
      });
      // console.log("message", msg);
      ctx.session.calendarReply = {
        messageId: msg.message_id,
        chatId: msg.chat.id,
      };
      return true;
    }
    if (data === "create_new_trip") {
      ctx.session.state = "create_new_trip";
      // Переходим к стандартному сценарию создания новой поездки
      // break to next block
    } else {
      await ctx.answerCbQuery("Некорректное действие.");
      return true;
    }
  }

  // --- Создание нового инстанса для существующей поездки ---
  if (ctx.session.state === "create_trip_instance_for_existing" && callbackQuery) {
    let date = getDate();
    if (callbackQuery.data === "date_tomorrow") {
      date.setDate(date.getDate() + 1);
    } else if (callbackQuery.data === "date_aftertomorrow") {
      date.setDate(date.getDate() + 2);
    } else if (callbackQuery.data === "date_calendar") {
      // Делегируем обработку календаря в handleCalendar
      return false;
    }
    if (date) {
      ctx.session.trip_date = date.toISOString().slice(0, 10);
      ctx.session.state = "enter_trip_time_existing";
      await ctx.answerCbQuery();
      await ctx.reply("Дата выбрана: " + formatDate(ctx.session.trip_date));
      await ctx.reply("Введите время отправления (например, 08:00):");
      console.log('time state existing', ctx.session.state)
    }
    return true;
  }
  console.log('state', ctx.session.state)
  if (
    ctx.session.state === "enter_trip_time_existing" &&
    message &&
    message.text
  ) {
    const timeText = message.text.trim();
    const match = timeText.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      await ctx.reply('Введите корректное время отправления в формате ЧЧ:ММ (например, 08:00 или 18:45)');
      return true;
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.reply('Часы должны быть от 0 до 23, минуты — от 0 до 59.');
      return true;
    }
    ctx.session.trip_time = timeText
    // Новый шаг: ввод времени в пути для переиспользования
    ctx.session.state = "enter_trip_duration_existing";
    await ctx.reply('Введите время в пути (например, 2:30):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }
  // --- Ввод времени в пути при переиспользовании ---
  if (
    ctx.session.state === "enter_trip_duration_existing" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    const durationText = message.text.trim();
    if (!/^\d{1,2}:[0-5]\d$/.test(durationText)) {
      await ctx.reply('Введите корректное время в пути (например, 2:30)');
      return true;
    }
    ctx.session.trip_duration = durationText;
    ctx.session.state = "enter_trip_price_existing";
    await ctx.reply("Введите цену за место (₽):");
    return true;
  }
  // console.log('state', ctx.session.state)
  if (
    ctx.session.state === "enter_trip_price_existing" &&
    message &&
    message.text
  ) {
    const price = parseInt(message.text, 10);
    if (isNaN(price) || price < 0) {
      await ctx.reply("Введите корректную цену.");
      return true;
    }
    ctx.session.trip_price = price;
    ctx.session.state = "choose_payment_method_existing";
    await ctx.reply("Выберите способ оплаты:", {
      reply_markup: {
        inline_keyboard: [
          [ { text: "Перевод", callback_data: "pay_transfer" } ],
          [ { text: "Наличные", callback_data: "pay_cash" } ],
          [ { text: "Перевод/наличные", callback_data: "pay_both" } ]
        ]
      }
    });
    return true;
  }

  if (ctx.session.state === "choose_payment_method_existing" && callbackQuery) {
    let method = null;
    if (callbackQuery.data === "pay_transfer") method = "transfer";
    if (callbackQuery.data === "pay_cash") method = "cash";
    if (callbackQuery.data === "pay_both") method = "both";
    if (!method) {
      await ctx.answerCbQuery("Некорректный выбор.");
      return true;
    }
    ctx.session.payment_method = method;
    // --- Новый этап: ввод адреса отправления ---
    ctx.session.state = "enter_departure_address_reuse";
    await ctx.reply('Введите адрес места отправления (улица, дом, ориентир):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }
  // --- Ввод адреса отправления при переиспользовании ---
  if (
    ctx.session.state === "enter_departure_address_reuse" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.departure_address = message.text;
    ctx.session.state = "enter_arrival_address_reuse";
    await ctx.reply('Адрес отправления сохранён')
    await ctx.reply('Введите адрес места прибытия (улица, дом, ориентир):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }

  // --- Ввод адреса прибытия при переиспользовании ---
  if (
    ctx.session.state === "enter_arrival_address_reuse" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.arrival_address = message.text;
    ctx.session.state = "enter_trip_comment_reuse";
    await ctx.reply('Адрес прибытия сохранён')
    await ctx.reply("Добавьте комментарий к поездке (например, информация о посылках, пожелания и т.д.) или отправьте '-' если не требуется:", {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }

  // --- Ввод комментария при переиспользовании поездки ---
  if (
    ctx.session.state === "enter_trip_comment_reuse" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.trip_comment = message.text === '-' ? '' : message.text;
    ctx.session.state = "confirm_reuse_trip";
    const trip = ctx.session.selected_trip;
    let method = ctx.session.payment_method;
    let msg = `Проверьте введённые данные:\n` +
      `Город отправления: ${trip.departure_city || ''}\n` +
      `Адрес отправления: ${ctx.session.departure_address || ''}\n` +
      `Город прибытия: ${trip.arrival_city || ''}\n` +
      `Адрес прибытия: ${ctx.session.arrival_address || ''}\n` +
      `Дата: ${ctx.session.trip_date || ''}\n` +
      `Время: ${ctx.session.trip_time || ''}\n` +
      (ctx.session.trip_duration ? `Время в пути: ${ctx.session.trip_duration}\n` : '') +
      `Цена за место: ${ctx.session.trip_price || ''} рублей\n` +
      `Способ оплаты: ${method === 'transfer' ? 'Перевод' : method === 'cash' ? 'Наличные' : 'Перевод/наличные'}\n` +
      `Свободных мест: ${trip.seats || ''}` +
      (ctx.session.trip_comment ? `\nКомментарий: ${ctx.session.trip_comment}` : '');
    await ctx.reply(msg, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Сохранить', callback_data: 'save_reuse_trip_confirmed' },
            { text: 'Отмена', callback_data: 'save_reuse_trip_cancel' }
          ]
        ]
      }
    });
    return true;
  }

  // --- Обработка подтверждения/отмены для reuse_trip ---
  if (ctx.session.state === "confirm_reuse_trip" && callbackQuery) {
    if (callbackQuery.data === 'save_reuse_trip_confirmed') {
      try {
        const trip = ctx.session.selected_trip;
        await knex("trip_instances").insert({
          trip_id: trip.id,
          departure_date: ctx.session.trip_date,
          departure_time: ctx.session.trip_time,
          available_seats: trip.seats,
          price: ctx.session.trip_price,
          payment_method: ctx.session.payment_method,
          status: "active",
          departure_address: ctx.session.departure_address || null,
          arrival_address: ctx.session.arrival_address || null,
          duration: ctx.session.trip_duration || null,
          comment: ctx.session.trip_comment || null
        });
        await ctx.editMessageText('Поездка создана!');
        await showDriverMenu(ctx)
      } catch (e) {
        await ctx.reply("Ошибка создания поездки: " + e.message);
      }
      ctx.session.state = null;
      ctx.session.selected_trip = null;
      ctx.session.payment_method = null;
      ctx.session.trip_comment = null;
      return true;
    } else if (callbackQuery.data === 'save_reuse_trip_cancel') {
      await ctx.editMessageText('Создание поездки отменено.');
      ctx.session.state = null;
      ctx.session.selected_trip = null;
      ctx.session.payment_method = null;
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }

  // --- Стандартное создание новой поездки (как раньше, но цена в trip_instances) ---
  if (
    ctx.session.state === "create_new_trip" ||
    (message &&
      message.text === "Создать новую поездку" &&
      !ctx.session.state)
  ) {
    // Сначала проверяем наличие авто
    const cars = await knex("cars")
      .where("user_id", ctx.session.user.id)
      .orderBy("is_default", "desc")
      .orderBy("id", "asc");
    if (!cars.length) {
      await ctx.reply("У вас нет добавленных автомобилей.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Добавить авто", callback_data: "add_car_for_trip_creation" }],
          ],
        },
      });
      ctx.session.state = "awaiting_add_car_for_trip";
      return true;
    }
  // --- Обработка добавления авто прямо из создания поездки ---
  if (ctx.session.state === "awaiting_add_car_for_trip" && callbackQuery) {
    if (callbackQuery.data === "add_car_for_trip_creation") {
      // Сохраняем флаг, что мы в процессе создания поездки
      ctx.session.creating_trip_after_car = true;
      ctx.session.state = "car_manage_keyboard";
      // Передаём управление cars.mjs (handleDriverCars)
      await next();
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }

  // --- Возврат к созданию поездки после добавления авто ---
  // if (ctx.session.creating_trip_after_car && ctx.session.state === null) {
  //   // Проверяем, появились ли авто
  //   const cars = await knex("cars")
  //     .where("user_id", ctx.session.user.id)
  //     .orderBy("is_default", "desc")
  //     .orderBy("id", "asc");
  //   if (!cars.length) {
  //     await ctx.reply("Автомобиль не найден. Пожалуйста, добавьте авто и попробуйте снова.");
  //     return true;
  //   }
  //   ctx.session.cars = cars;
  //   ctx.session.car_page = 0;
  //   ctx.session.state = "choose_car_for_trip";
  //   ctx.session.creating_trip_after_car = false;
  //   const pageSize = 10;
  //   const showCars = cars.slice(0, pageSize);
  //   const buttons = showCars.map((c, i) => [
  //     {
  //       text: `${c.brand} ${c.model} (${c.license_plate})${c.is_default ? " ⭐️" : ""}`,
  //       callback_data: `choose_trip_car_${i}`,
  //     },
  //   ]);
  //   if (cars.length > pageSize) {
  //     buttons.push([{ text: "Далее ▶️", callback_data: "trip_car_page_1" }]);
  //   }
  //   await ctx.reply("Выберите автомобиль для поездки:", {
  //     reply_markup: { inline_keyboard: buttons },
  //   });
  //   return true;
  // }
    // Получаем города из БД
    const cities = await knex("cities").where({ is_active: true }).orderBy("name", "asc");
    if (!cities.length) {
      await ctx.reply("Нет доступных городов.");
      return true;
    }
    ctx.session.cities = cities;
    ctx.session.city_page = 0;
    ctx.session.state = "choose_departure_city";
    // Показать города для отправления
    const pageSize = 10;
    const showCities = cities.slice(0, pageSize);
    const buttons = showCities.map((c, i) => [
      {
        text: c.name,
        callback_data: `choose_departure_city_${i}`,
      },
    ]);
    if (cities.length > pageSize) {
      buttons.push([
        { text: "Далее ▶️", callback_data: "departure_city_page_1" },
      ]);
    }
    await ctx.reply("Выберите город отправления:", {
      reply_markup: { inline_keyboard: buttons },
    });
    return true;
  }

  // --- Пагинация и выбор города отправления ---
  if (ctx.session.state === "choose_departure_city" && callbackQuery) {
    const cities = ctx.session.cities;
    const pageSize = 10;
    const data = callbackQuery.data;
    if (data.startsWith("departure_city_page_")) {
      const page = parseInt(data.replace("departure_city_page_", ""), 10);
      const totalPages = Math.ceil(cities.length / pageSize);
      const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCities.map((c, i) => [
        {
          text: c.name,
          callback_data: `choose_departure_city_${i}`,
        },
      ]);
      if (page > 0)
        buttons.push([
          { text: "◀️ Назад", callback_data: `departure_city_page_${page - 1}` },
        ]);
      if (page < totalPages - 1)
        buttons.push([
          { text: "Далее ▶️", callback_data: `departure_city_page_${page + 1}` },
        ]);
      ctx.session.city_page = page;
      await ctx.editMessageText("Выберите город отправления:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    if (data.startsWith("choose_departure_city_")) {
      const idx = parseInt(data.replace("choose_departure_city_", ""), 10) + (ctx.session.city_page || 0) * pageSize;
      const city = cities[idx];
      if (!city) {
        await ctx.answerCbQuery("Некорректный выбор.");
        return true;
      }
      ctx.session.departure_city = city;
      ctx.session.state = "choose_arrival_city";
      // Показать города для прибытия (исключая выбранный)
      const arrivalCities = cities.filter(c => c.id !== city.id);
      ctx.session.arrival_cities = arrivalCities;
      ctx.session.arrival_city_page = 0;
      const showCities = arrivalCities.slice(0, pageSize);
      const buttons = showCities.map((c, i) => [
        {
          text: c.name,
          callback_data: `choose_arrival_city_${i}`,
        },
      ]);
      if (arrivalCities.length > pageSize) {
        buttons.push([
          { text: "Далее ▶️", callback_data: "arrival_city_page_1" },
        ]);
      }
      await ctx.reply("Выберите город прибытия:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }

  // --- Пагинация и выбор города прибытия ---
  if (ctx.session.state === "choose_arrival_city" && callbackQuery) {
    const cities = ctx.session.arrival_cities;
    const pageSize = 10;
    const data = callbackQuery.data;
    if (data.startsWith("arrival_city_page_")) {
      const page = parseInt(data.replace("arrival_city_page_", ""), 10);
      const totalPages = Math.ceil(cities.length / pageSize);
      const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCities.map((c, i) => [
        {
          text: c.name,
          callback_data: `choose_arrival_city_${i}`,
        },
      ]);
      if (page > 0)
        buttons.push([
          { text: "◀️ Назад", callback_data: `arrival_city_page_${page - 1}` },
        ]);
      if (page < totalPages - 1)
        buttons.push([
          { text: "Далее ▶️", callback_data: `arrival_city_page_${page + 1}` },
        ]);
      ctx.session.arrival_city_page = page;
      await ctx.editMessageText("Выберите город прибытия:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    if (data.startsWith("choose_arrival_city_")) {
      const idx = parseInt(data.replace("choose_arrival_city_", ""), 10) + (ctx.session.arrival_city_page || 0) * pageSize;
      const city = cities[idx];
      if (!city) {
        await ctx.answerCbQuery("Некорректный выбор.");
        return true;
      }
      ctx.session.arrival_city = city;
      ctx.session.state = "enter_trip_date_choice";
      await ctx.reply(`Маршрут: ${ctx.session.departure_city.name} → ${city.name}`);
      // Кнопки быстрых дат и календарь
      const msg = await ctx.reply("Выберите дату поездки:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Сегодня", callback_data: "date_today" },
              { text: "Завтра", callback_data: "date_tomorrow" },
              { text: "Послезавтра", callback_data: "date_aftertomorrow" },
            ],
            [
              {
                text: "Указать дату 📅",
                callback_data: "enter_trip_date_calendar",
              },
            ],
          ],
        },
      });
      ctx.session.calendarReply = {
        messageId: msg.message_id,
        chatId: msg.chat.id,
      };
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }
  // --- Выбор даты через кнопки ---
  if (ctx.session.state === "enter_trip_date_choice" && callbackQuery) {
    let date = getDate();
    console.log(date)
    if (callbackQuery.data === "date_tomorrow") {
      date.setDate(date.getDate() + 1);
    } else if (callbackQuery.data === "date_aftertomorrow") {
      date.setDate(date.getDate() + 2);
    } else if (callbackQuery.data === "date_calendar") {
      // Делегируем обработку календаря в handleCalendar
      return false;
    }
    if (date) {
      ctx.session.trip_date = date.toISOString().slice(0, 10);
      ctx.session.state = "enter_trip_time";
      await ctx.answerCbQuery();
      await ctx.reply("Дата выбрана: " + formatDate(ctx.session.trip_date));
      await ctx.reply("Введите время отправления (например, 08:00):");
    }
    return true;
  }
  // --- Ввод времени ---
  if (
    ctx.session.state === "enter_trip_time" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    const timeText = message.text.trim();
    const match = timeText.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      await ctx.reply('Введите корректное время отправления в формате ЧЧ:ММ (например, 08:00 или 18:45)');
      return true;
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.reply('Часы должны быть от 0 до 23, минуты — от 0 до 59.');
      return true;
    }
    ctx.session.trip_time = timeText
    ctx.session.state = "enter_trip_duration";
    await ctx.reply('Введите время в пути (например, 2:30):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }

  // --- Ввод времени в пути ---
  if (
    ctx.session.state === "enter_trip_duration" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    const durationText = message.text.trim();
    // Accept formats like "2:30", "02:30", "0:45"
    if (!/^\d{1,2}:[0-5]\d$/.test(durationText)) {
      await ctx.reply('Введите корректное время в пути (например, 2:30)');
      return true;
    }
    ctx.session.trip_duration = message.text;
    ctx.session.state = "enter_departure_address";
    await ctx.reply('Введите адрес места отправления (улица, дом, ориентир):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }
  // --- Ввод адреса отправления ---
  if (ctx.session.state === "enter_departure_address" && message && message.text) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.departure_address = message.text;
    await ctx.reply('Адрес отправления сохранён')
    await ctx.reply('Введите адрес места прибытия (улица, дом, ориентир):', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.session.state = "enter_arrival_address";
    return true;
  }
  // --- Ввод адреса прибытия ---
  if (ctx.session.state === "enter_arrival_address" && message && message.text) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.arrival_address = message.text;
    await ctx.reply('Адрес прибытия сохранён')
    await ctx.reply('Сколько мест доступно?', {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.session.state = "enter_trip_seats";
    return true;
  }
  // --- (Больше не требуется этапов с локацией) ---
  // --- Ввод количества мест ---
  if (
    ctx.session.state === "enter_trip_seats" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    const seats = parseInt(message.text, 10);
    if (isNaN(seats) || seats < 1) {
      await ctx.reply("Введите корректное количество мест");
      return true;
    }
    ctx.session.trip_seats = seats;
    ctx.session.trip_seats = parseInt(message.text, 10);
    await ctx.reply("Цена за место (₽):", {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.session.state = "enter_trip_price";
    return true;
  }
  // --- Ввод цены ---
  if (
    ctx.session.state === "enter_trip_price" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    const price = parseInt(message.text, 10);
    if (isNaN(price) || price < 0 || price > 100000) {
      await ctx.reply("Введите корректную цену");
      return true;
    }
    ctx.session.trip_price = parseInt(message.text, 10);
    ctx.session.state = "enter_trip_comment";
    await ctx.reply("Добавьте комментарий к поездке (например, информация о посылках, пожелания и т.д.) или отправьте '-' если не требуется:", {
      reply_markup: {
        keyboard: [["Отмена"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }
  // --- Ввод комментария к поездке ---
  if (
    ctx.session.state === "enter_trip_comment" &&
    message &&
    message.text
  ) {
    if (message.text === "Отмена") {
      ctx.session.state = null;
      if (showDriverMenu) await showDriverMenu(ctx);
      return true;
    }
    ctx.session.trip_comment = message.text === '-' ? '' : message.text;
    ctx.session.state = "choose_payment_method";
    await ctx.reply("Выберите способ оплаты:", {
      reply_markup: {
        inline_keyboard: [
          [ { text: "Перевод", callback_data: "pay_transfer" } ],
          [ { text: "Наличные", callback_data: "pay_cash" } ],
          [ { text: "Перевод/наличные", callback_data: "pay_both" } ]
        ]
      }
    });
    return true;
  }

  if (ctx.session.state === "choose_payment_method" && callbackQuery) {
    let method = null;
    if (callbackQuery.data === "pay_transfer") method = "transfer";
    if (callbackQuery.data === "pay_cash") method = "cash";
    if (callbackQuery.data === "pay_both") method = "both";
    if (!method) {
      await ctx.answerCbQuery("Некорректный выбор.");
      return true;
    }
    ctx.session.payment_method = method;
    // Переходим к выбору автомобиля
    const cars = await knex("cars")
      .where("user_id", ctx.session.user.id)
      .orderBy("is_default", "desc")
      .orderBy("id", "asc");
    if (!cars.length) {
      await ctx.reply(
        'У вас нет добавленных автомобилей. Добавьте авто в меню "Мои автомобили".',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Добавить авто", callback_data: "add_car" }],
            ],
          },
        }
      );
      ctx.session.state = "car_manage_keyboard";
      return true;
    }
    ctx.session.cars = cars;
    ctx.session.car_page = 0;
    ctx.session.state = "choose_car_for_trip";
    // Показываем список авто с инлайн-клавиатурой
    const pageSize = 10;
    const showCars = cars.slice(0, pageSize);
    const buttons = showCars.map((c, i) => [
      {
        text: `${c.brand} ${c.model} (${c.license_plate})${
          c.is_default ? " ⭐️" : ""
        }`,
        callback_data: `choose_trip_car_${i}`,
      },
    ]);
    if (cars.length > pageSize) {
      buttons.push([{ text: "Далее ▶️", callback_data: "trip_car_page_1" }]);
    }
    await ctx.reply("Выберите автомобиль для поездки:", {
      reply_markup: { inline_keyboard: buttons },
    });
    return true;
  }
  // --- Пагинация и выбор авто для новой поездки ---
  console.log('state', ctx.session.state, callbackQuery, ['choose_car_for_trip', 'awaiting_phone'].includes(ctx.session.state))
  if (['choose_car_for_trip', 'awaiting_phone', 'awaiting_phone_input', 'awaiting_phone_choice'].includes(ctx.session.state) || ctx.session.confirm_trip) {
    if (callbackQuery) {}
    const cars = ctx.session.cars;
    const pageSize = 10;
    const data = callbackQuery?.data;
    if (data?.startsWith("trip_car_page_")) {
      const page = parseInt(data.replace("trip_car_page_", ""), 10);
      const totalPages = Math.ceil(cars.length / pageSize);
      const showCars = cars.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCars.map((c, i) => [
        {
          text: `${c.brand} ${c.model} (${c.license_plate})${
            c.is_default ? " ⭐️" : ""
          }`,
          callback_data: `choose_trip_car_${i}`,
        },
      ]);
      if (page > 0)
        buttons.push([
          { text: "◀️ Назад", callback_data: `trip_car_page_${page - 1}` },
        ]);
      if (page < totalPages - 1)
        buttons.push([
          { text: "Далее ▶️", callback_data: `trip_car_page_${page + 1}` },
        ]);
      ctx.session.car_page = page;
      await ctx.editMessageText("Выберите автомобиль для поездки:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    console.log('data s', data, ctx.session.state)
    if ((data && data.startsWith("choose_trip_car_")) || ctx.session.state === 'awaiting_phone' || ctx.session.state === 'choose_car_for_trip' || ctx.session.state === 'awaiting_phone_input' || ctx.session.state === 'awaiting_phone_choice' || callbackQuery?.data === 'save_trip_confirmed' || callbackQuery?.data === 'save_trip_cancel') {
      console.log('try to choose car')
      if (data?.startsWith("choose_trip_car_")) {
        const idx =
          parseInt(data.replace("choose_trip_car_", ""), 10) +
          (ctx.session.car_page || 0) * pageSize;
        const car = cars[idx];
        if (!car) {
          await ctx.answerCbQuery("Некорректный выбор.");
          return true;
        }
        ctx.session.selected_trip_car = car;
        // Сохраняем поездку с выбранным авто
        await ctx.editMessageText(
          `Автомобиль выбран: ${car.brand} ${car.model} (${car.license_plate})`
        );
      }
      console.log('check user phone', ctx?.session?.user?.phone, ctx?.message?.contact)
      // Если нет телефона и не пришёл контакт, предлагаем выбор
      if (!ctx?.session?.user?.phone && !ctx?.message?.contact && ctx.session.state !== 'awaiting_phone_input' && ctx.session.state !== 'awaiting_phone_choice') {
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
      // Если пользователь выбрал ввод вручную
      console.log('awaiting phone choice', ctx.session.state, ctx.message)
      if (ctx.session.state === 'awaiting_phone_choice' && ctx.message && ctx.message.text === 'Ввести номер вручную') {
        await ctx.reply('Пожалуйста, введите номер телефона в формате +79991234567:', {
          reply_markup: {
            keyboard: [["Отмена"]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
        ctx.session.state = 'awaiting_phone_input';
        return;
      }
      // Если пользователь прислал контакт
      if (ctx?.message?.contact) {
        ctx.session.user.phone = ctx.message.contact.phone_number;
        await knex('users').where({ telegram_id: ctx.from.id }).update({ phone: ctx.session.user.phone });
        // Сбросить клавиатуру
        await ctx.reply('Телефон сохранён.', { reply_markup: { remove_keyboard: true } });
      }
      // Если пользователь вводит телефон вручную
      if (ctx.session.state === 'awaiting_phone_input' && ctx.message && ctx.message.text) {
        if (ctx.message.text === "Отмена") {
          ctx.session.state = null;
          if (showDriverMenu) await showDriverMenu(ctx);
          return;
        }
        const phone = ctx.message.text.trim();
        // Простейшая валидация (начинается с +7 и 11-15 символов)
        if (!/^\+7\d{10,14}$/.test(phone)) {
          await ctx.reply('Пожалуйста, введите корректный номер в формате +79991234567.');
          return;
        }
        ctx.session.user.phone = phone;
        await knex('users').where({ telegram_id: ctx.from.id }).update({ phone });
        await ctx.reply('Телефон сохранён.', { reply_markup: { remove_keyboard: true } });
        ctx.session.state = null;
      }
      // --- Этап проверки данных перед сохранением ---
      if (!ctx.session.confirm_trip) {
        // Сохраняем флаг, чтобы не зациклиться
        ctx.session.confirm_trip = true;
        // Формируем текст проверки
        const car = ctx.session.selected_trip_car;
        const msg = `Проверьте введённые данные:\n` +
          `Город отправления: ${ctx.session.departure_city?.name || ''}\n` +
          `Адрес отправления: ${ctx.session.departure_address || ''}\n` +
          `Город прибытия: ${ctx.session.arrival_city?.name || ''}\n` +
          `Адрес прибытия: ${ctx.session.arrival_address || ''}\n` +
          `Дата отправления: ${ctx.session.trip_date || ''}\n` +
          `Время отправления: ${ctx.session.trip_time || ''}\n` +
          `Время в пути: ${ctx.session.trip_duration || ''}\n` +
          `Авто: ${car?.brand || ''} ${car?.model || ''}\n` +
          `Госномер: ${car?.license_plate || ''}\n` +
          `Количество свободных мест: ${ctx.session.trip_seats || ''} шт.\n` +
          `Цена за место: ${ctx.session.trip_price || ''} рублей` +
          (ctx.session.trip_comment ? `\nКомментарий: ${ctx.session.trip_comment}` : '');
        await ctx.reply(msg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Сохранить', callback_data: 'save_trip_confirmed' },
                { text: 'Отмена', callback_data: 'save_trip_cancel' }
              ]
            ]
          }
        });
        return true;
      }
    // --- Обработка кнопок подтверждения/отмены сохранения поездки ---
    console.log('try to save trip')
    if (callbackQuery && (callbackQuery.data === 'save_trip_confirmed' || callbackQuery.data === 'save_trip_cancel')) {
      console.log('try to save trip 2', callbackQuery.data)
      if (callbackQuery.data === 'save_trip_confirmed') {
        try {
          const [tripId] = await knex("trips").insert({
            driver_id: ctx.session.user.id,
            departure_city_id: ctx.session.departure_city.id,
            arrival_city_id: ctx.session.arrival_city.id,
            is_series: false,
            seats: ctx.session.trip_seats,
            car_id: ctx.session.selected_trip_car.id,
          });
          await knex("trip_instances").insert({
            trip_id: tripId,
            departure_date: ctx.session.trip_date,
            departure_time: ctx.session.trip_time,
            available_seats: ctx.session.trip_seats,
            price: ctx.session.trip_price,
            payment_method: ctx.session.payment_method,
            status: "active",
            departure_address: ctx.session.departure_address || null,
            arrival_address: ctx.session.arrival_address || null,
            duration: ctx.session.trip_duration || null,
            comment: ctx.session.trip_comment || null
          });
          await ctx.editMessageText('Поездка создана!');
          if (showDriverMenu) await showDriverMenu(ctx);
        } catch (e) {
          await ctx.reply("Ошибка создания поездки: " + e.message);
        }
      } else if (callbackQuery.data === 'save_trip_cancel') {
        await ctx.editMessageText('Создание поездки отменено.');
        if (showDriverMenu) await showDriverMenu(ctx);
      }
      ctx.session.state = null;
      ctx.session.selected_trip_car = null;
      ctx.session.confirm_trip = null;
      return true;
    }
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }
  // --- Просмотр своих поездок и истории ---
  if (message && message.text === "Мои поездки") {
    await ctx.reply("Выберите что показать:", {
      reply_markup: {
        keyboard: [["Активные поездки", "История поездок"], ["Назад в меню"]],
        resize_keyboard: true,
      },
    });
    ctx.session.state = "my_trips_menu_driver";
    return true;
  }
  // --- Меню "Мои поездки" для водителя ---
  if (message?.text === "Активные поездки" || ctx?.callbackQuery?.data === "back_to_trips") {
    // Главная выборка по trip_instances
    const trips = await knex("trip_instances as inst")
      .join("trips", "inst.trip_id", "trips.id")
      .join("cities as dep", "trips.departure_city_id", "dep.id")
      .join("cities as arr", "trips.arrival_city_id", "arr.id")
      .join("cars as cars", "trips.car_id", "cars.id")
      .where("trips.driver_id", ctx.session.user.id)
      .andWhere("inst.status", "=", "active")
      .select(
        "inst.id as instance_id",
        "inst.departure_time",
        "inst.departure_date",
        "inst.price",
        "inst.available_seats",
        "inst.status",
        "trips.*",
        "dep.name as departure_city",
        "arr.name as arrival_city",
        "cars.brand as car_brand",
        "cars.model as car_model",
        "cars.license_plate as license_plate"
      )
      .orderBy("inst.departure_date", "asc")
      .orderBy("inst.departure_time", "asc");
    if (!trips.length) {
      await ctx.reply("У вас нет активных поездок.");
      return true;
    }
    const page = 0;
    const pageSize = 10;
    const totalPages = Math.ceil(trips.length / pageSize);
    const showTrips = trips.slice(page * pageSize, (page + 1) * pageSize);
    const buttons = showTrips.map((t, i) => [
      {
        text: `${t.departure_city} → ${t.arrival_city} | ${formatDate(
          t.departure_date
        )} ${formatTime(t.departure_time)}`,
        callback_data: `edit_trip_${i}`,
      },
    ]);
    if (totalPages > 1) {
      buttons.push([
        { text: "Далее ▶️", callback_data: `trip_page_${page + 1}` },
      ]);
    }
    ctx.session.trips = trips;
    ctx.session.trip_page = 0;
    ctx.session.state = "edit_trip_keyboard";
    await ctx.reply("Ваши активные поездки:", {
      reply_markup: { inline_keyboard: buttons },
    });
    return true;
  }
  if (message?.text === "История поездок") {
    const history = await knex("trip_instances as inst")
      .join("trips", "inst.trip_id", "trips.id")
      .join("cities as dep", "trips.departure_city_id", "dep.id")
      .join("cities as arr", "trips.arrival_city_id", "arr.id")
      .join("cars as cars", "trips.car_id", "cars.id")
      .where("trips.driver_id", ctx.session.user.id)
      .andWhere(function () {
        this.where("inst.status", "cancelled").orWhere(
          "inst.status",
          "completed"
        );
      })
      .select(
        "inst.id as instance_id",
        "inst.departure_time",
        "inst.departure_date",
        "inst.price",
        "inst.available_seats",
        "inst.status",
        "trips.*",
        "dep.name as departure_city",
        "arr.name as arrival_city",
        "cars.brand as car_brand",
        "cars.model as car_model",
        "cars.license_plate as license_plate"
      )
      .orderBy("inst.departure_date", "desc")
      .orderBy("inst.departure_time", "desc")
      .limit(10);
    // console.log(history);
    if (!history.length) {
      await ctx.reply("История пуста.");
      return true;
    }
    let msg = "История поездок:";
    for (let i = 0; i < history.length; i++) {
      const t = history[i];
      msg += `\n\n${i + 1}. ${t.departure_city} → ${
        t.arrival_city
      }\nДата: ${formatDate(t.departure_date)}\nМест: ${t.seats}\nСвободно: ${
        t.available_seats
      }\nЦена: ${t.price}₽\nСтатус: ${
        t.status === "cancelled" ? "Отменена" : "Завершена"
      }`;
    }
    await ctx.reply(msg);
    ctx.session.state = null;
    return true;
  }
  if (
    ctx.session.state === "my_trips_menu_driver" &&
    message &&
    message.text
  ) {
    if (message.text === "Назад в меню") {
      ctx.session.state = null;
      await ctx.reply("Главное меню.");
      return true;
    }
    await ctx.reply("Выберите действие из меню.");
    return true;
  }
  // --- Выбор поездки для редактирования через инлайн-клавиатуру с пагинацией ---
  if (ctx.session.state === "edit_trip_keyboard" && callbackQuery) {
    const pageSize = 10;
    const data = callbackQuery.data;
    if (data.startsWith("edit_trip_")) {
      const idx =
        parseInt(data.replace("edit_trip_", ""), 10) +
        (ctx.session.trip_page || 0) * pageSize;
      let trip = ctx.session.trips && ctx.session.trips[idx];
      if (!trip) {
        await ctx.answerCbQuery("Некорректный выбор.");
        return true;
      }
      // Если payment_method или адреса отсутствуют, подгружаем из trip_instances
      if (!trip.payment_method || !trip.departure_address || !trip.arrival_address) {
        const [instance] = await knex("trip_instances").where({ id: trip.instance_id });
        if (instance) {
          if (!trip.payment_method) trip.payment_method = instance.payment_method;
          if (!trip.departure_address) trip.departure_address = instance.departure_address;
          if (!trip.arrival_address) trip.arrival_address = instance.arrival_address;
        }
      }
      ctx.session.selected_trip = {
        ...trip,
        instance_id: trip.instance_id,
        trip_id: trip.trip_id || trip.id, // для совместимости
      };
      ctx.session.state = "edit_trip_action_keyboard";
      let paymentMethodText = 'Не указан';
      if (trip.payment_method === 'transfer') paymentMethodText = 'Перевод';
      else if (trip.payment_method === 'cash') paymentMethodText = 'Наличные';
      else if (trip.payment_method === 'both') paymentMethodText = 'Перевод/наличные';
      await ctx.editMessageText(
        `Выбрана поездка: ${trip.departure_city} → ${trip.arrival_city} (${formatDate(trip.departure_date)})\n` +
        `Время отправления: ${formatTime(trip.departure_time)}\n` +
        `Адрес отправления: ${trip.departure_address || '-'}\n` +
        `Адрес прибытия: ${trip.arrival_address || '-'}\n` +
        `Стоимость: ${trip.price}₽\n` +
        `Мест всего: ${trip.seats}\n` +
        `Мест свободно: ${trip.available_seats}\n` +
        `Способ оплаты: ${paymentMethodText}\n` +
        `Авто: ${trip.car_brand} ${trip.car_model} (${trip.license_plate})`
      );
      await ctx.reply("Что изменить?", {
        reply_markup: {
          inline_keyboard: editTripKeyboard,
        },
      });
      return true;
    }
    if (data.startsWith("trip_page_")) {
      const page = parseInt(data.replace("trip_page_", ""), 10);
      const trips = ctx.session.trips;
      const totalPages = Math.ceil(trips.length / pageSize);
      const showTrips = trips.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showTrips.map((t, i) => [
        {
          text: `${t.departure_city} → ${t.arrival_city} | ${t.created_at
            .toISOString()
            .slice(0, 10)}`,
          callback_data: `edit_trip_${i}`,
        },
      ]);
      if (page > 0)
        buttons.push([
          { text: "◀️ Назад", callback_data: `trip_page_${page - 1}` },
        ]);
      if (page < totalPages - 1)
        buttons.push([
          { text: "Далее ▶️", callback_data: `trip_page_${page + 1}` },
        ]);
      ctx.session.trip_page = page;
      await ctx.editMessageText("Ваши активные поездки:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }
  // --- Действия над поездкой через инлайн-клавиатуру ---
  console.log('try to change payment method', ctx.session.state, callbackQuery)
  if (ctx.session.state === "edit_trip_action_keyboard" || ctx.session.state === "edit_trip_payment_method" || ctx.session.state === "edit_departure_address" || ctx.session.state === "edit_arrival_address") {
    if (callbackQuery?.data === "edit_payment_method") {
      ctx.session.state = "edit_trip_payment_method";
      await ctx.reply("Выберите новый способ оплаты:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Перевод", callback_data: "pay_transfer" }],
            [{ text: "Наличные", callback_data: "pay_cash" }],
            [{ text: "Перевод/наличные", callback_data: "pay_both" }],
            [{ text: "Отмена", callback_data: "cancel_edit_payment_method" }],
          ],
        },
      });
      return true;
    }
    if (callbackQuery?.data === "edit_departure_address") {
      ctx.session.state = "edit_departure_address";
      await ctx.reply("Введите новый адрес отправления:");
      return true;
    }
    if (callbackQuery?.data === "edit_arrival_address") {
      ctx.session.state = "edit_arrival_address";
      await ctx.reply("Введите новый адрес прибытия:");
      return true;
    }
    if (callbackQuery?.data === "edit_comment") {
      ctx.session.state = "edit_trip_comment_edit";
      await ctx.reply("Введите новый комментарий к поездке (или '-' чтобы удалить):");
      return true;
    }
    // Обработка ввода нового комментария
    if (ctx.session.state === "edit_trip_comment_edit" && message && message.text) {
      const newComment = message.text.trim() === '-' ? '' : message.text.trim();
      await knex("trip_instances")
        .where("id", ctx.session.selected_trip.instance_id)
        .update({ comment: newComment });
      ctx.session.selected_trip.comment = newComment;
      await ctx.reply("Комментарий обновлён!");
      ctx.session.state = "edit_trip_action_keyboard";
      await ctx.reply("Что изменить?", {
        reply_markup: { inline_keyboard: editTripKeyboard },
      });
      return true;
    }
    // Обработка ввода нового адреса отправления
    if (ctx.session.state === "edit_departure_address" && message && message.text) {
      const newAddress = message.text.trim();
      await knex("trip_instances")
        .where("id", ctx.session.selected_trip.instance_id)
        .update({ departure_address: newAddress });
      ctx.session.selected_trip.departure_address = newAddress;
      await ctx.reply("Адрес отправления обновлён!");
      ctx.session.state = "edit_trip_action_keyboard";
      await ctx.reply("Что изменить?", {
        reply_markup: { inline_keyboard: editTripKeyboard },
      });
      return true;
    }
    // Обработка ввода нового адреса прибытия
    if (ctx.session.state === "edit_arrival_address" && message && message.text) {
      const newAddress = message.text.trim();
      await knex("trip_instances")
        .where("id", ctx.session.selected_trip.instance_id)
        .update({ arrival_address: newAddress });
      ctx.session.selected_trip.arrival_address = newAddress;
      await ctx.reply("Адрес прибытия обновлён!");
      ctx.session.state = "edit_trip_action_keyboard";
      await ctx.reply("Что изменить?", {
        reply_markup: { inline_keyboard: editTripKeyboard },
      });
      return true;
    }
  // --- Изменение способа оплаты при редактировании ---
  if (ctx.session.state === "edit_trip_payment_method" && callbackQuery) {
    if (callbackQuery.data === "cancel_edit_payment_method") {
      ctx.session.state = "edit_trip_action_keyboard";
      await ctx.reply("Изменение способа оплаты отменено.", {
        reply_markup: { inline_keyboard: editTripKeyboard },
      });
      return true;
    }
    console.log('change payment method', callbackQuery.data)
    let method = null;
    if (callbackQuery.data === "pay_transfer") method = "transfer";
    if (callbackQuery.data === "pay_cash") method = "cash";
    if (callbackQuery.data === "pay_both") method = "both";
    if (!method) {
      await ctx.answerCbQuery("Некорректный выбор.");
      return true;
    }
    await knex("trip_instances")
      .where("id", ctx.session.selected_trip.instance_id)
      .update({ payment_method: method });
    ctx.session.selected_trip.payment_method = method;
    let paymentMethodText = 'Не указан';
    if (method === 'transfer') paymentMethodText = 'Перевод';
    else if (method === 'cash') paymentMethodText = 'Наличные';
    else if (method === 'both') paymentMethodText = 'Перевод/наличные';
    await ctx.reply(`Способ оплаты обновлён: ${paymentMethodText}`);
    ctx.session.state = "edit_trip_action_keyboard";
    await ctx.reply("Что изменить?", {
      reply_markup: { inline_keyboard: editTripKeyboard },
    });
    return true;
  }
    const data = callbackQuery.data;
    if (data === "show_passengers") {
      // Показать список пассажиров только для выбранного инстанса
      const trip = ctx.session.selected_trip;
      if (!trip || !trip.instance_id) {
        await ctx.reply("Поездка не выбрана.");
        return true;
      }
      const bookings = await knex("bookings")
        .join("users", "bookings.user_id", "users.id")
        .where("bookings.trip_instance_id", trip.instance_id)
        .whereIn("bookings.status", ["active", "awaiting_confirmation"]) // показываем активных и ожидающих подтверждения
        .select(
          "bookings.id as booking_id",
          "users.name",
          "users.phone",
          "bookings.seats",
          "bookings.confirmed"
        );
      let msg = `Пассажиры по поездке: ${formatDate(trip.departure_date)} ${formatTime(trip.departure_time)}`;
      if (!bookings.length) {
        msg += "\nНет активных бронирований.";
        await ctx.reply(msg);
        return true;
      }
      for (const b of bookings) {
        msg += `\n\nПассажир: ${b.name}\nТелефон: ${formatPhone(b.phone)}\nМест: ${b.seats}`;
        if (!b.confirmed) {
          await ctx.reply(
            `Бронирование пассажира ${b.name} (${formatPhone(b.phone)}), мест: ${b.seats}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: 'Подтвердить', callback_data: `driver_confirm_booking_${b.booking_id}` },
                    { text: 'Отклонить', callback_data: `driver_reject_booking_${b.booking_id}` }
                  ]
                ]
              }
            }
          );
        }
      }
      await ctx.reply(msg);
      return true;
    }
    // Обработка подтверждения/отмены бронирования водителем
    console.log('handle booking confirmation', data);
    if (data && data.startsWith('driver_confirm_booking_')) {
      console.log('Confirming booking:', data);
      const bookingId = data.replace('driver_confirm_booking_', '');
      const bookingRow = await knex('bookings').where({ id: bookingId }).first();
      if (!bookingRow) { await ctx.answerCbQuery('Бронь не найдена'); return true; }
      await trx('bookings').where({ id: bookingRow.id }).update({ status: 'active', confirmed: true });
      const booking = await knex('bookings')
        .join('users', 'bookings.user_id', 'users.id')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .join('trips', 'trip_instances.trip_id', 'trips.id')
        .join('cities as dep', 'trips.departure_city_id', 'dep.id')
        .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
        .select('users.telegram_id as passenger_telegram_id', 'dep.name as departure_city', 'arr.name as arrival_city', 'trip_instances.departure_date', 'trip_instances.departure_time')
        .where('bookings.id', bookingId)
        .first();
      if (booking && booking.passenger_telegram_id) {
        await addNotifyJob(
          'booking_confirmed',
          booking.passenger_telegram_id,
          `Ваша бронь подтверждена! Поездка: ${booking.departure_city} → ${booking.arrival_city}, дата: ${formatDate(booking.departure_date)}, время: ${formatTime(booking.departure_time)}`
        );
      }
      await ctx.reply('Бронирование подтверждено.');
      await ctx.answerCbQuery('Бронирование подтверждено');
      return true;
    }
    if (data && data.startsWith('driver_reject_booking_')) {
      const bookingId = data.replace('driver_reject_booking_', '');
      const b = await knex('bookings').where({ id: bookingId }).first();
      if (b) {
        await knex.transaction(async trx => {
          await trx('trip_instances').where({ id: b.trip_instance_id }).increment('available_seats', b.seats);
          await trx('bookings').where({ id: bookingId }).update({ status: 'cancelled', confirmed: false });
        });
        if (b.payment_id) {
          const pay = await knex('payments').where({ id: b.payment_id }).first();
          if (pay && pay.status === 'succeeded' && pay.provider_payment_id) {
            const yc = initYooCheckout();
            if (yc) {
              try {
                const idemp = `refund-booking-${bookingId}-${Date.now()}`;
                const refund = await createRefund(yc, {
                  providerPaymentId: pay.provider_payment_id,
                  amount: pay.amount,
                  description: `Возврат комиссии: отклонена бронь #${bookingId}`,
                  idempotenceKey: idemp,
                });
                await knex('payments').where({ id: b.payment_id }).update({ raw: JSON.stringify({ ...(pay.raw || {}), refund }) });
                try {
                  await knex('refunds').insert({
                    payment_id: b.payment_id,
                    booking_id: bookingId,
                    provider_refund_id: refund?.id || null,
                    amount: pay.amount,
                    currency: pay.currency || 'RUB',
                    status: refund?.status || 'created',
                    raw: JSON.stringify(refund || {})
                  });
                } catch {}
                const passenger = await knex('users').where({ id: b.user_id }).first();
                if (passenger?.telegram_id) {
                  await addNotifyJob('booking_refund', passenger.telegram_id, `Возврат комиссии оформлен (${pay.amount}₽) по отменённой брони #${bookingId}. Средства вернутся в течение 1–7 дней.`);
                }
              } catch (e) { console.error('Ошибка возврата комиссии', e.message); }
            }
          }
        }
      } else {
        await knex('bookings').where({ id: bookingId }).update({ status: 'cancelled', confirmed: false });
      }
      // Получить telegram_id пассажира и детали поездки
      const booking = await knex('bookings')
        .join('users', 'bookings.user_id', 'users.id')
        .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
        .join('trips', 'trip_instances.trip_id', 'trips.id')
        .join('cities as dep', 'trips.departure_city_id', 'dep.id')
        .join('cities as arr', 'trips.arrival_city_id', 'arr.id')
        .select('users.telegram_id as passenger_telegram_id', 'dep.name as departure_city', 'arr.name as arrival_city', 'trip_instances.departure_date', 'trip_instances.departure_time')
        .where('bookings.id', bookingId)
        .first();
      if (booking && booking.passenger_telegram_id) {
        await addNotifyJob(
          'booking_rejected',
          booking.passenger_telegram_id,
          `Ваша бронь отклонена водителем. Поездка: ${booking.departure_city} → ${booking.arrival_city}, дата: ${formatDate(booking.departure_date)}, время: ${formatTime(booking.departure_time)}`
        );
      }
      await ctx.reply('Бронирование отклонено.');
      await ctx.answerCbQuery('Бронирование отклонено');
      return true;
    }
    if (data === "edit_car") {
      // Получаем список авто водителя
      const cars = await knex("cars")
        .where("user_id", ctx.session.user.id)
        .orderBy("is_default", "desc")
        .orderBy("id", "asc");
      if (!cars.length) {
        await ctx.reply("У вас нет добавленных автомобилей.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Добавить авто", callback_data: "add_car" }],
            ],
          },
        });
        ctx.session.state = "car_manage_keyboard";
        return true;
      }
      ctx.session.cars = cars;
      ctx.session.car_page = 0;
      ctx.session.state = "edit_trip_choose_car";
      const pageSize = 10;
      const showCars = cars.slice(0, pageSize);
      const buttons = showCars.map((c, i) => [
        {
          text: `${c.brand} ${c.model} (${c.license_plate})${
            c.is_default ? " ⭐️" : ""
          }`,
          callback_data: `edit_trip_car_${i}`,
        },
      ]);
      if (cars.length > pageSize) {
        buttons.push([
          { text: "Далее ▶️", callback_data: "edit_trip_car_page_1" },
        ]);
      }
      await ctx.reply("Выберите автомобиль для этой поездки:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    if (data === "edit_seats") {
      ctx.session.state = "edit_trip_seats";
      await ctx.reply("Введите новое количество мест:");
      return true;
    }
    if (data === "edit_available_seats") {
      ctx.session.state = "edit_trip_available_seats";
      await ctx.reply("Введите новое количество свободных мест:");
      return true;
    }
    if (data === "edit_price") {
      ctx.session.state = "edit_trip_price";
      await ctx.reply("Введите новую цену:");
      return true;
    }
    if (data === "complete_trip") {
      // Завершить и все её инстансы
      await knex("trip_instances")
        .where("trip_id", ctx.session.selected_trip.id)
        .update({ status: "completed" });
      await ctx.reply("Поездка завершена!");
      ctx.session.state = null;
      ctx.session.selected_trip = null;
      ctx.session.trips = null;
      return true;
    }
    if (data === "complete_trip") {
      // Завершить только выбранный инстанс
      await knex("trip_instances")
        .where("id", ctx.session.selected_trip.instance_id)
        .update({ status: "completed" });
      await ctx.reply("Поездка завершена!");
      ctx.session.state = null;
      ctx.session.selected_trip = null;
      ctx.session.trips = null;
      return true;
    }
    if (data === "cancel_trip") {
      const { addTripJob } = await import("../../../queue/tripQueue.mjs");
      await addTripJob("cancel", {
        instanceId: ctx.session.selected_trip.instance_id,
      });
      await ctx.reply("Поездка отменена");
      ctx.session.state = null;
      ctx.session.selected_trip = null;
      ctx.session.trips = null;
      return true;
    }
  }
  if (
    ctx.session.state === "edit_trip_available_seats" &&
    message &&
    message.text
  ) {
    // console.log("seats", ctx.session.selected_trip);
    const available_seats = parseInt(message.text, 10);
    if (isNaN(available_seats) || available_seats < 0) {
      await ctx.reply(
        "Введите корректное число свободных мест (0 или больше)."
      );
      return true;
    }
    // Обновляем только для активного инстанса поездки (можно доработать для выбора инстанса)
    await knex("trip_instances")
      .where("id", ctx.session.selected_trip.instance_id)
      .update({ available_seats });
    ctx.session.selected_trip.available_seats = available_seats;
    await ctx.reply("Количество свободных мест обновлено!");
    ctx.session.state = "edit_trip_action_keyboard";
    // Показать меню редактирования снова
    await ctx.reply("Что изменить?", {
      reply_markup: {
        inline_keyboard: editTripKeyboard,
      },
    });
    return true;
  }
  // --- Обработка ввода нового количества мест ---
  if (
    ctx.session.state === "edit_trip_seats" &&
    message &&
    message.text
  ) {
    const seats = parseInt(message.text, 10);
    if (isNaN(seats) || seats < 1) {
      await ctx.reply("Введите корректное число мест (от 1 и больше).");
      return true;
    }

    await knex("trips")
      .where("id", ctx.session.selected_trip.trip_id)
      .update({ seats });
    await knex("trip_instances")
      .where("id", ctx.session.selected_trip.instance_id)
      .update({ available_seats: seats });
    // Обновить available_seats в trip_instances, если нужно (оставим как есть, если требуется — добавить логику)
    ctx.session.selected_trip.seats = seats;
    await ctx.reply("Количество мест обновлено!");
    ctx.session.state = "edit_trip_action_keyboard";
    // Показать меню редактирования снова
    await ctx.reply("Что изменить?", {
      reply_markup: {
        inline_keyboard: editTripKeyboard,
      },
    });
    return true;
  }

  // --- Обработка ввода новой цены ---
  if (
    ctx.session.state === "edit_trip_price" &&
    message &&
    message.text
  ) {
    const price = parseInt(message.text, 10);
    if (isNaN(price) || price < 0) {
      await ctx.reply("Введите корректную цену (целое число, не меньше 0).");
      return true;
    }
    // Обновить цену только для активного инстанса
    await knex("trip_instances")
      .where("id", ctx.session.selected_trip.instance_id)
      .update({ price });
    ctx.session.selected_trip.price = price;
    await ctx.reply("Цена обновлена!");
    ctx.session.state = "edit_trip_action_keyboard";
    // Показать меню редактирования снова
    await ctx.reply("Что изменить?", {
      reply_markup: {
        inline_keyboard: editTripKeyboard,
      },
    });
    return true;
  }
  // --- Пагинация и выбор авто для редактирования поездки ---
  if (ctx.session.state === "edit_trip_choose_car" && callbackQuery) {
    const cars = ctx.session.cars;
    const pageSize = 10;
    const data = callbackQuery.data;
    if (data.startsWith("edit_trip_car_page_")) {
      const page = parseInt(data.replace("edit_trip_car_page_", ""), 10);
      const totalPages = Math.ceil(cars.length / pageSize);
      const showCars = cars.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCars.map((c, i) => [
        {
          text: `${c.brand} ${c.model} (${c.license_plate})${
            c.is_default ? " ⭐️" : ""
          }`,
          callback_data: `edit_trip_car_${i}`,
        },
      ]);
      if (page > 0)
        buttons.push([
          { text: "◀️ Назад", callback_data: `edit_trip_car_page_${page - 1}` },
        ]);
      if (page < totalPages - 1)
        buttons.push([
          { text: "Далее ▶️", callback_data: `edit_trip_car_page_${page + 1}` },
        ]);
      ctx.session.car_page = page;
      await ctx.editMessageText("Выберите автомобиль для этой поездки:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return true;
    }
    if (data.startsWith("edit_trip_car_")) {
      const idx =
        parseInt(data.replace("edit_trip_car_", ""), 10) +
        (ctx.session.car_page || 0) * pageSize;
      const car = cars[idx];
      if (!car) {
        await ctx.answerCbQuery("Некорректный выбор.");
        return true;
      }
      // Обновляем car_id у выбранной поездки
      // console.log("car", car);
      const resp = await knex("trips")
        .where("id", ctx.session.selected_trip.id)
        .update({ car_id: car.id });
      // console.log("resp", resp);
      ctx.session.selected_trip.car_id = car.id;
      await ctx.editMessageText(
        `Автомобиль обновлён: ${car.brand} ${car.model} (${car.license_plate})`
      );
      ctx.session.state = "edit_trip_action_keyboard";
      // Показываем меню редактирования снова
      await ctx.reply("Что изменить?", {
        reply_markup: {
          inline_keyboard: editTripKeyboard,
        },
      });
      return true;
    }
    await ctx.answerCbQuery("Некорректное действие.");
    return true;
  }
  return false;
}

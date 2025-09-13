import { Markup } from 'telegraf'
import { formatPhone } from '../../utils/formatPhone.mjs'
import db from '../../db/db.mjs';
import { getSetting } from '../../utils/getSetting.mjs'

// Общая логика: приветствие, регистрация, выбор роли
export async function showDriverMenu(ctx) {
  // Строим клавиатуру динамически, добавляя "Бонусы" если баннер загружен
  let keyboard = [
    [
      { text: 'Создать новую поездку' },
      { text: 'Мои поездки' }
    ],
    [
      { text: 'Мои автомобили' },
    ],
    [
      { text: 'Статистика' }
    ]
  ];
  try {
    const row = await db('app_settings').where({ key: 'bonus_banner_url' }).first();
    if (row?.value) {
      keyboard[2].push({ text: 'Бонусы' });
    }
  } catch { /* ignore */ }
  keyboard.push([
    { text: 'Изменить номер телефона' }
  ]);
  keyboard.push([{ text: 'Сменить роль' }]);
  await ctx.reply('Меню водителя:', {
    reply_markup: {
      keyboard,
      resize_keyboard: true
    }
  });
  ctx.session.state = null;
}

export async function showPassengerMenu(ctx) {
  await ctx.reply('Меню пассажира:', {
    reply_markup: {
      keyboard: [
        [
          { text: '🔍 Найти поездку' },
          { text: 'Мои бронирования' }
        ],
        // [
        //   { text: 'История поездок' }
        // ],
        [
          { text: 'Изменить номер телефона' }
        ],
        [{ text: 'Сменить роль' }]
      ],
      resize_keyboard: true
    }
  });
  ctx.session.state = null;
}
export function commonLogic(knex) {
  // Обработка изменения номера телефона
  async function handleChangePhone(ctx) {
    const user = ctx.session?.user;
    let phone = user?.phone || '';
    if (!phone) {
      // Попробовать получить из БД
      const dbUser = await knex('users').where({ telegram_id: ctx.from.id }).first();
      phone = dbUser?.phone || '';
    }
    await ctx.reply(`Ваш текущий номер телефона: ${phone ? formatPhone(phone) : 'не указан'}`);
    await ctx.reply('Вы можете ввести новый номер вручную или отправить контакт:', {
      reply_markup: {
        keyboard: [
          [ { text: 'Ввести номер вручную' }, Markup.button.contactRequest('Прикрепить телефон') ],
          [ { text: 'Отмена' } ]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.session.state = 'change_phone_waiting_choice';
  }
  async function showRoleMenu(ctx) {
    await ctx.reply('Выберите роль:', {
      reply_markup: {
        keyboard: [
          ['Водитель', 'Пассажир']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    ctx.session.state = 'choose_role';
  }

  const showUserMenu = async ctx => {
    const role = ctx.session?.user?.role;
    if (role === 'driver') {
  await showDriverMenu(ctx, knex);
    } else if (role === 'passenger') {
      await showPassengerMenu(ctx);
    }
  }


  return async (ctx, next) => {
    const session = ctx.session || {}
    try {
      // Обработка этапа выбора способа изменения телефона
      if (ctx?.session?.state === 'change_phone_waiting_choice') {
        if (ctx.message && ctx.message.text === 'Ввести номер вручную') {
          await ctx.reply('Пожалуйста, введите номер телефона в формате +79991234567:', {
            reply_markup: {
              keyboard: [[ 'Отмена' ]],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          });
          ctx.session.state = 'change_phone_manual_input';
          return true;
        }
        if (ctx.message && ctx.message.contact) {
          const phone = ctx.message.contact.phone_number;
          await knex('users').where({ telegram_id: ctx.from.id }).update({ phone });
          ctx.session.user.phone = phone;
          await ctx.reply('Телефон успешно обновлён!', { reply_markup: { remove_keyboard: true } });
          await showUserMenu(ctx);
          ctx.session.state = null;
          return true;
        }
        if (ctx.message && ctx.message.text === 'Отмена') {
          ctx.session.state = null;
          await ctx.reply('Изменение номера отменено.', { reply_markup: { remove_keyboard: true } });
          return true;
        }
        // Если что-то другое — просим выбрать вариант
        await ctx.reply('Пожалуйста, выберите способ: введите номер вручную или отправьте контакт.');
        return true;
      }
      // Обработка ручного ввода номера
      if (ctx?.session?.state === 'change_phone_manual_input') {
        if (ctx.message && ctx.message.text === 'Отмена') {
          ctx.session.state = null;
          await ctx.reply('Изменение номера отменено.', { reply_markup: { remove_keyboard: true } });
          return true;
        }
        if (ctx.message && ctx.message.text) {
          const phone = ctx.message.text.trim();
          if (!/^\+7\d{10,14}$/.test(phone)) {
            await ctx.reply('Пожалуйста, введите корректный номер в формате +79991234567.');
            return true;
          }
          await knex('users').where({ telegram_id: ctx.from.id }).update({ phone });
          ctx.session.user.phone = phone;
          await ctx.reply('Телефон успешно обновлён!', { reply_markup: { remove_keyboard: true } });
          await showUserMenu(ctx);
          ctx.session.state = null;
          return true;
        }
        // Если что-то другое
        await ctx.reply('Пожалуйста, введите номер телефона в формате +79991234567 или нажмите "Отмена".');
        return true;
      }
      console.log('start', ctx?.session?.state, ctx?.update?.callback_query?.data)
      try {
        let user = await knex('users').where({ telegram_id: ctx.from.id }).first();
        if (user) {
          session.user = user
        }
        ctx.session = session
    // Универсальная команда отмены
    if (ctx.message && /^(отмена|cancel|назад|Назад в меню)$/i.test(ctx.message.text)) {
          ctx.session.state = null;
          ctx.session.trips = null;
          ctx.session.selected_trip = null;
          ctx.session.bookings = null;
          // Показываем меню по роли
          if (session.user?.role === 'driver') {
            await showDriverMenu(ctx, knex);
          } else if (session?.user?.role === 'passenger') {
            await showPassengerMenu(ctx);
          } else {
            await showRoleMenu(ctx);
          }
          return true;
        }
    
        // /start — регистрация и выбор роли
        if (ctx.message && ctx.message.text === '/start') {
          ctx.session = {};
          if (!session.user) {
            await ctx.reply(`👋 Приветствуем вас в PoezdkaKrasBot!
Здесь вы можете найти попутчиков или предложить поездку 🚗
По Краснодарскому Краю.

📌 Водителям — удобно публиковать маршруты
📌 Пассажирам — легко находить поездки и бронировать места

<a href="https://poezdkabot.ru/offer.html">Оферта по оказанию услуг</a>`, { parse_mode: 'HTML' })
            await showRoleMenu(ctx);
          } else if (session.user?.role === 'driver') {
            await showDriverMenu(ctx, knex);
          } else if (session.user?.role === 'passenger') {
            await showPassengerMenu(ctx);
          }
          return true;
        }

        if (ctx.message && ctx.message.text === '/support') {
          await ctx.reply(`Если у вас возникли вопросы, проблемы или предложения, вы можете обратиться в нашу службу поддержки: @PoezdkaSupport`)
          return true
        }
        // Выбор роли
        if (ctx.session?.state === 'choose_role' && ctx.message && (ctx.message.text === 'Водитель' || ctx.message.text === 'Пассажир')) {
          const role = ctx.message.text === 'Водитель' ? 'driver' : 'passenger';
          if (session?.user) {
            await knex('users').where({ telegram_id: ctx.from.id }).update({ role });
          } else {
            await knex('users').insert({ telegram_id: ctx.from.id, name: ctx.from.first_name || '', phone: '', role });
          }
          ctx.session.state = null;
          if (role === 'driver') {
            const videoUrl = await getSetting('training_video_url')
            if (videoUrl) {
              try {
                await ctx.replyWithVideo(videoUrl, { caption: 'Видео обучения' })
              } catch (e) { console.log('Error video reply', e) }
            }
            await showDriverMenu(ctx, knex);
          } else {
            await showPassengerMenu(ctx);
          }
          return true;
        }
    
        // Изменить номер телефона
        if (ctx.message && ctx.message.text === 'Изменить номер телефона') {
          await handleChangePhone(ctx);
          return true;
        }
        // Бонусы (отправить баннер, если загружен)
        if (ctx.message && ctx.message.text === 'Бонусы') {
          const bonusUrl = await getSetting('bonus_banner_url');
          if (bonusUrl) {
            await ctx.replyWithPhoto(bonusUrl, { caption: 'Наши бонусы для водителей' });
          }
        }
        // Статистика водителя
        if (ctx.message && ctx.message.text === 'Статистика') {
          const driver = session.user;
          // Периоды
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const monthStart = `${year}-${month}-01`;
          const nextMonth = new Date(year, now.getMonth() + 1, 1);
          const monthEnd = nextMonth.toISOString().slice(0, 10);

          // Всего завершённых поездок
          const completedTripsTotalRow = await knex('trip_instances as inst')
            .join('trips', 'inst.trip_id', 'trips.id')
            .where('trips.driver_id', driver.id)
            .andWhere('inst.status', 'completed')
            .count({ count: 'inst.id' })
            .first();

          // Всего перевезённых пассажиров (подтверждённые брони в завершённых поездках)
          const passengerCountRow = await knex('bookings')
            .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
            .join('trips', 'trip_instances.trip_id', 'trips.id')
            .where('trips.driver_id', driver.id)
            .andWhere('trip_instances.status', 'completed')
            .andWhere('bookings.confirmed', true)
            .sum({ count: 'bookings.seats' })
            .first();

          // Завершённые поездки за текущий месяц
          const completedTripsMonthRow = await knex('trip_instances as inst')
            .join('trips', 'inst.trip_id', 'trips.id')
            .where('trips.driver_id', driver.id)
            .andWhere('inst.status', 'completed')
            .andWhere('inst.departure_date', '>=', monthStart)
            .andWhere('inst.departure_date', '<', monthEnd)
            .count({ count: 'inst.id' })
            .first();

          // Перевезённые пассажиры за текущий месяц
          const passengerCountMonthRow = await knex('bookings')
            .join('trip_instances', 'bookings.trip_instance_id', 'trip_instances.id')
            .join('trips', 'trip_instances.trip_id', 'trips.id')
            .where('trips.driver_id', driver.id)
            .andWhere('trip_instances.status', 'completed')
            .andWhere('bookings.confirmed', true)
            .andWhere('trip_instances.departure_date', '>=', monthStart)
            .andWhere('trip_instances.departure_date', '<', monthEnd)
            .sum({ count: 'bookings.seats' })
            .first();

          const completedCount = Number(completedTripsTotalRow?.count ?? 0);
          const passengerCount = Number(passengerCountRow?.count ?? 0);
          const completedCountMonth = Number(completedTripsMonthRow?.count ?? 0);
          const passengerCountMonth = Number(passengerCountMonthRow?.count ?? 0);
          let msg = `Статистика водителя:\n` +
            `Завершённых поездок: ${completedCount}\n` +
            `Перевезено пассажиров: ${passengerCount}`;
          msg += `\n\nЗа текущий месяц:`;
          msg += `\nЗавершённых поездок: ${completedCountMonth}`;
          msg += `\nПеревезено пассажиров: ${passengerCountMonth}`;
          await ctx.reply(msg);
          return true;
        }
        // Смена роли из меню
        if (ctx.message && ctx.message.text === 'Сменить роль') {
          await showRoleMenu(ctx);
          ctx.session.state = 'choose_role';
          return true;
        }
        
        // Показывать меню по роли, если пользователь уже есть
        if (session.user && ctx?.session?.user?.role === 'driver' && ctx?.message?.text === 'Кабинет водителя') {
          await showDriverMenu(ctx, knex);
          return true;
        }
        if (session.user && ctx?.session?.user?.role === 'passenger' && ctx?.message?.text === 'Кабинет пассажира') {
          await showPassengerMenu(ctx);
          return true;
        }
    
        await next();
      } catch (error) {
        console.error('Error in commonLogic:', error);
        await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
        return;
      }
    } catch (error) {
      console.error('Error handling common logic:', error);
      await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
  };
}

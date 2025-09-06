// Общая логика обработки календаря для выбора дат (используется и водителем, и пассажиром)
import Calendar from 'telegram-inline-calendar';
import { formatDate } from '../../utils/formatDate.mjs'


let calendar = null
const setCalendar = (bot) => {
  const date = new Date()
  const maxDate = date.setDate(date.getDate() + 30)
    calendar = new Calendar(bot, {
    language: 'ru',
    date_format: 'YYYY-MM-DD',
    weekStartingDay: 1,
    start_date: new Date(),
    stop_date: maxDate,
    timeZone: 'Europe/Moscow',
    bot_api: 'telegraf'
  })
}


export function handleCalendar(bot) {
  // console.log('register calendar')
  return async (ctx, next) => {
    const callbackQuery = ctx?.update?.callback_query
    try {
      // console.log('handle calendar', ctx)
      // Для водителя: enter_trip_date_calendar
      const tripDateCalendarMap = {
        create_trip_date_for_existing: 'enter_trip_time_existing',
        enter_trip_date_calendar: 'enter_trip_time'
      }
      const nextMethod = tripDateCalendarMap[ctx.session.state] || tripDateCalendarMap[callbackQuery?.data]
      if (nextMethod) {
        ctx.session.state = callbackQuery?.data
        ctx.session.nextMethod = nextMethod
      }
      console.log('try driver calendar', ctx.session.nextMethod, callbackQuery?.data, ctx.session.state)
      if (ctx.session.nextMethod) {
        if (!calendar) {
          setCalendar(bot)
        }
        if (!ctx.session.isCalendarOpen) {
          calendar.startNavCalendar(callbackQuery?.message);
          ctx.session.isCalendarOpen = true
        } else if (callbackQuery?.data?.trim()) {
          // console.log(callbackQuery)
          const res = calendar.clickButtonCalendar(callbackQuery)
          // console.log('response', res)
          const { chatId, messageId } = ctx.session.calendarReply
          if (res !== -1) {
            // console.log('edit edit')
            ctx.session.isCalendarOpen = false
            ctx.session.trip_date = res;
            ctx.session.state = ctx.session.nextMethod;
            console.log('set next state', ctx.session.state)
            ctx.session.nextMethod = null
            // console.log('edit ', chatId, messageId, 'Дата выбрана: ' + formatDate(ctx.session.trip_date))
            const response = await ctx.editMessageText(`Дата поездки: ${formatDate(ctx.session.trip_date)}`, {
              chat_id: chatId,
              message_id: messageId
            });
            // console.log('response', response)
            await ctx.reply('Введите время отправления (например, 08:00):');
          }
        }
        // await ctx.answerCbQuery();
        return true;
      }
      // Для пассажира: search_date_calendar
      // console.log('try passenger calendar', callbackQuery?.data?.trim(), ctx.session.state)
      if (callbackQuery?.data === 'search_date_calendar' || ctx.session.state === 'search_date_calendar') {
        ctx.session.state = 'search_date_calendar';
        // console.log('search_date_calendar', callbackQuery?.data?.trim())
        if (!calendar) {
          setCalendar(bot)
        }
        if (!ctx.session.isCalendarOpen) {
          calendar.startNavCalendar(callbackQuery?.message);
          ctx.session.isCalendarOpen = true
        } else if (callbackQuery?.data?.trim()) {
          const res = calendar.clickButtonCalendar(callbackQuery)
          // console.log('response', res)
          const { chatId, messageId } = ctx.session.calendarReply
          if (res !== -1) {
            ctx.session.date = res;
            ctx.session.state = 'search_date';
            const response = await ctx.editMessageText(`Дата выбрана: ${formatDate(ctx.session.date)}`, {
              chat_id: chatId,
              message_id: messageId
            });
            // console.log(response)
            await ctx.reply('Поиск поездок')
            await next()
            // Переход к поиску поездок должен быть реализован в логике пассажира
          }
        }
        // await ctx.answerCbQuery();
        return true;
      }
    } catch (error) {
      console.log('Error', error)
    }
    await next()
  }
}

// Мидлвар для интеграции telegram-inline-calendar (заглушка)
export function calendarMiddleware() {
  return async (ctx, next) => {
    // ...тут будет интеграция календаря для выбора дат
    await next();
  };
}

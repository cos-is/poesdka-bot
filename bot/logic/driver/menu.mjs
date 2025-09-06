// Главное меню и навигация для водителя
export async function handleDriverMenu(ctx, next, knex) {
  const message = ctx?.session.previousMessage || ctx.message
  if (message && message.text === 'Кабинет водителя') {
    await ctx.reply('Меню водителя:', {
      reply_markup: {
        keyboard: [
          [
            { text: 'Создать новую поездку' },
            { text: 'Мои поездки' }
          ],
          [
            { text: 'Мои автомобили' },
            // { text: 'Найти пассажира' }
          ],
          [{ text: 'Сменить роль' }]
        ],
        resize_keyboard: true
      }
    });
    ctx.session.state = null;
    return true;
  }
  // ...другие пункты меню и возврат в меню...
  return false;
}

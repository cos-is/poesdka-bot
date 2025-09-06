// Логика админ-бота для управления данными приложения
// Возможности: CRUD города, маршруты, точки маршрутов, бан/анбан пользователей
const pageSize = 10;
export const adminLogic = (knex) => {
  return async (ctx, next) => {
    if (!ctx.session) {
      ctx.session = {};
    }
    try {
  // --- МАРШРУТЫ ---
    if (ctx.message && ctx.message.text === 'Маршруты') {
      const routes = await knex('routes').orderBy('name', 'asc');
      if (!routes.length) {
        await ctx.reply('Список маршрутов пуст.', {
          reply_markup: { inline_keyboard: [[{ text: 'Добавить маршрут', callback_data: 'add_route' }]] }
        });
        ctx.session.state = 'routes_menu';
        return;
      }
      const page = 0;
  // ...existing code...
      const totalPages = Math.ceil(routes.length / pageSize);
      const showRoutes = routes.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showRoutes.map((r, i) => [{ text: r.name, callback_data: `route_${i}` }]);
      if (totalPages > 1) buttons.push([{ text: 'Далее ▶️', callback_data: 'route_page_1' }]);
      buttons.push([{ text: 'Добавить маршрут', callback_data: 'add_route' }]);
      ctx.session.routes = routes;
      ctx.session.route_page = 0;
      ctx.session.state = 'routes_menu';
      await ctx.reply('Список маршрутов:', { reply_markup: { inline_keyboard: buttons } });
      return;
    }

    // Пагинация по маршрутам
    if (ctx.session.state === 'routes_menu' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
  // ...existing code...
      if (data === 'add_route') {
        ctx.session.state = 'add_route_name';
        await ctx.reply('Введите название нового маршрута:');
        return;
      }
      if (data.startsWith('route_page_')) {
        const page = parseInt(data.replace('route_page_', ''), 10);
        const routes = ctx.session.routes;
        const totalPages = Math.ceil(routes.length / pageSize);
        const showRoutes = routes.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showRoutes.map((r, i) => [{ text: r.name, callback_data: `route_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `route_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `route_page_${page + 1}` }]);
        buttons.push([{ text: 'Добавить маршрут', callback_data: 'add_route' }]);
        ctx.session.route_page = page;
        await ctx.editMessageText('Список маршрутов:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('route_')) {
        const idx = parseInt(data.replace('route_', ''), 10) + (ctx.session.route_page || 0) * pageSize;
        const route = ctx.session.routes[idx];
        if (!route) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        ctx.session.selected_route = route;
        ctx.session.state = 'route_action_menu';
        await ctx.editMessageText(`Маршрут: ${route.name}\nНаправление: ${route.direction}\nКод: ${route.preset_code}\nID: ${route.id}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Изменить', callback_data: 'edit_route' },
                { text: 'Удалить', callback_data: 'delete_route' }
              ],
              [
                { text: 'Назад', callback_data: 'back_to_routes' }
              ]
            ]
          }
        });
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Действия над маршрутом
    if (ctx.session.state === 'route_action_menu' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const route = ctx.session.selected_route;
      if (!route) {
        await ctx.answerCbQuery('Маршрут не найден.');
        return;
      }
      if (data === 'edit_route') {
        ctx.session.state = 'edit_route_name';
        await ctx.reply('Введите новое название маршрута:');
        return;
      }
      if (data === 'delete_route') {
        await knex('routes').where('id', route.id).delete();
        await ctx.reply('Маршрут удалён.');
        ctx.session.state = null;
        return;
      }
      if (data === 'back_to_routes') {
        ctx.session.state = null;
        await ctx.reply('Возврат к списку маршрутов. Нажмите "Маршруты" в меню.');
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Добавление маршрута
    if (ctx.session.state === 'add_route_name' && ctx.message && ctx.message.text) {
      ctx.session.new_route = { name: ctx.message.text.trim() };
      ctx.session.state = 'add_route_direction';
      await ctx.reply('Введите направление маршрута (например, "Москва — Казань"):');
      return;
    }
    if (ctx.session.state === 'add_route_direction' && ctx.message && ctx.message.text) {
      ctx.session.new_route.direction = ctx.message.text.trim();
      ctx.session.state = 'add_route_code';
      await ctx.reply('Введите код маршрута (preset_code):');
      return;
    }
    if (ctx.session.state === 'add_route_code' && ctx.message && ctx.message.text) {
      ctx.session.new_route.preset_code = ctx.message.text.trim();
      const { name, direction, preset_code } = ctx.session.new_route;
      await knex('routes').insert({ name, direction, preset_code });
      await ctx.reply('Маршрут добавлен!');
      ctx.session.state = null;
      ctx.session.new_route = null;
      return;
    }

    // Редактирование маршрута
    if (ctx.session.state === 'edit_route_name' && ctx.message && ctx.message.text) {
      const name = ctx.message.text.trim();
      if (!name) {
        await ctx.reply('Название не может быть пустым.');
        return;
      }
      await knex('routes').where('id', ctx.session.selected_route.id).update({ name });
      await ctx.reply('Название маршрута обновлено!');
      ctx.session.state = null;
      return;
    }
    // Главное меню
    if (ctx.message && ctx.message.text === '/start') {
      ctx.session = {};
      await ctx.reply('Админ-панель:', {
        reply_markup: {
          keyboard: [
            ['Города', 'Маршруты'],
            ['Точки маршрутов', 'Пользователи']
          ],
          resize_keyboard: true
        }
      });
      ctx.session.state = null;
      return;
    }

    // --- ТОЧКИ МАРШРУТОВ ---
    if (ctx.message && ctx.message.text === 'Точки маршрутов') {
      // Сначала выбрать маршрут
      const routes = await knex('routes').orderBy('name', 'asc');
      if (!routes.length) {
        await ctx.reply('Нет маршрутов. Добавьте маршрут сначала.');
        return;
      }
      const page = 0;
  // ...existing code...
      const totalPages = Math.ceil(routes.length / pageSize);
      const showRoutes = routes.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showRoutes.map((r, i) => [{ text: r.name, callback_data: `routept_route_${i}` }]);
      if (totalPages > 1) buttons.push([{ text: 'Далее ▶️', callback_data: 'routept_route_page_1' }]);
      ctx.session.routes = routes;
      ctx.session.routept_route_page = 0;
      ctx.session.state = 'routept_choose_route';
      await ctx.reply('Выберите маршрут для управления точками:', { reply_markup: { inline_keyboard: buttons } });
      return;
    }

    // Пагинация и выбор маршрута для точек
    if (ctx.session.state === 'routept_choose_route' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('routept_route_page_')) {
        const page = parseInt(data.replace('routept_route_page_', ''), 10);
        const routes = ctx.session.routes;
        const totalPages = Math.ceil(routes.length / pageSize);
        const showRoutes = routes.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showRoutes.map((r, i) => [{ text: r.name, callback_data: `routept_route_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `routept_route_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `routept_route_page_${page + 1}` }]);
        ctx.session.routept_route_page = page;
        await ctx.editMessageText('Выберите маршрут для управления точками:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('routept_route_')) {
        const idx = parseInt(data.replace('routept_route_', ''), 10) + (ctx.session.routept_route_page || 0) * pageSize;
        const route = ctx.session.routes[idx];
        if (!route) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        ctx.session.selected_route = route;
        // Получить точки маршрута
        const points = await knex('route_points')
          .where('route_id', route.id)
          .join('cities', 'route_points.city_id', 'cities.id')
          .orderBy('route_points.order', 'asc')
          .select('route_points.*', 'cities.name as city_name');
        ctx.session.route_points = points;
        ctx.session.routept_point_page = 0;
        ctx.session.state = 'routept_points_menu';
        // Показать точки маршрута
        let msg = `Точки маршрута "${route.name}":`;
        if (!points.length) msg += '\n(нет точек)';
  const page = 0;
  const totalPages = Math.ceil(points.length / pageSize);
  const showPoints = points.slice(page * pageSize, (page + 1) * pageSize);
  const buttons = showPoints.map((p, i) => [{ text: `${p.order + 1}. ${p.city_name}`, callback_data: `routept_point_${i}` }]);
  if (totalPages > 1) buttons.push([{ text: 'Далее ▶️', callback_data: 'routept_point_page_1' }]);
  buttons.push([{ text: 'Добавить точку', callback_data: 'routept_add_point' }]);
  await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons } });
  return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Пагинация и действия над точками маршрута
    if (ctx.session.state === 'routept_points_menu' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
  // ...existing code...
      const points = ctx.session.route_points;
      if (data === 'routept_add_point') {
        ctx.session.state = 'routept_add_point_city';
        // Список городов для выбора
        const cities = await knex('cities').orderBy('name', 'asc');
        ctx.session.cities = cities;
        ctx.session.city_page = 0;
        const showCities = cities.slice(0, pageSize);
        const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `routept_city_${i}` }]);
        if (cities.length > pageSize) buttons.push([{ text: 'Далее ▶️', callback_data: 'routept_city_page_1' }]);
        await ctx.reply('Выберите город для новой точки:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('routept_point_page_')) {
        const page = parseInt(data.replace('routept_point_page_', ''), 10);
        const totalPages = Math.ceil(points.length / pageSize);
        const showPoints = points.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showPoints.map((p, i) => [{ text: `${p.order + 1}. ${p.city_name}`, callback_data: `routept_point_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `routept_point_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `routept_point_page_${page + 1}` }]);
        buttons.push([{ text: 'Добавить точку', callback_data: 'routept_add_point' }]);
        ctx.session.routept_point_page = page;
        await ctx.editMessageText('Точки маршрута:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('routept_point_')) {
        const idx = parseInt(data.replace('routept_point_', ''), 10) + (ctx.session.routept_point_page || 0) * pageSize;
        const point = points[idx];
        if (!point) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        ctx.session.selected_point = point;
        ctx.session.state = 'routept_point_action';
        await ctx.reply(`Точка: ${point.city_name}\nПорядок: ${point.order + 1}\nID: ${point.id}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Изменить город', callback_data: 'routept_edit_city' },
                { text: 'Изменить порядок', callback_data: 'routept_edit_order' },
                { text: 'Удалить', callback_data: 'routept_delete_point' }
              ],
              [
                { text: 'Назад', callback_data: 'routept_back_to_points' }
              ]
            ]
          }
        });
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Действия над точкой маршрута
    if (ctx.session.state === 'routept_point_action' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const point = ctx.session.selected_point;
      if (!point) {
        await ctx.answerCbQuery('Точка не найдена.');
        return;
      }
      if (data === 'routept_edit_city') {
        ctx.session.state = 'routept_edit_point_city';
        // Список городов для выбора
        const cities = await knex('cities').orderBy('name', 'asc');
        ctx.session.cities = cities;
        ctx.session.city_page = 0;
        const pageSize = 10;
        const showCities = cities.slice(0, pageSize);
        const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `routept_city_${i}` }]);
        if (cities.length > pageSize) buttons.push([{ text: 'Далее ▶️', callback_data: 'routept_city_page_1' }]);
        await ctx.reply('Выберите новый город:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data === 'routept_edit_order') {
        ctx.session.state = 'routept_edit_point_order';
        await ctx.reply('Введите новый порядок (число, начиная с 1):');
        return;
      }
      if (data === 'routept_delete_point') {
        await knex('route_points').where('id', point.id).delete();
        await ctx.reply('Точка маршрута удалена!');
        ctx.session.state = null;
        return;
      }
      if (data === 'routept_back_to_points') {
        ctx.session.state = null;
        await ctx.reply('Возврат к списку точек. Нажмите "Точки маршрутов" в меню.');
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Добавление точки маршрута — выбор города
    if (ctx.session.state === 'routept_add_point_city' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
  // ...existing code...
      const cities = ctx.session.cities;
      if (data.startsWith('routept_city_page_')) {
        const page = parseInt(data.replace('routept_city_page_', ''), 10);
        const totalPages = Math.ceil(cities.length / pageSize);
        const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `routept_city_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `routept_city_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `routept_city_page_${page + 1}` }]);
        ctx.session.city_page = page;
        await ctx.editMessageText('Выберите город:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('routept_city_')) {
        const idx = parseInt(data.replace('routept_city_', ''), 10) + (ctx.session.city_page || 0) * pageSize;
        const city = cities[idx];
        if (!city) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        // Добавить точку маршрута в конец
        const route = ctx.session.selected_route;
  const lastOrderRow = await knex('route_points').where('route_id', route.id).max('order as maxOrder');
  const lastOrder = (lastOrderRow[0].maxOrder ?? -1) + 1;
  await knex('route_points').insert({ route_id: route.id, city_id: city.id, order: lastOrder });
        await ctx.reply('Точка маршрута добавлена!');
        ctx.session.state = null;
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Изменение города точки маршрута
    if (ctx.session.state === 'routept_edit_point_city' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
  // ...existing code...
      const cities = ctx.session.cities;
      if (data.startsWith('routept_city_page_')) {
        const page = parseInt(data.replace('routept_city_page_', ''), 10);
        const totalPages = Math.ceil(cities.length / pageSize);
        const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `routept_city_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `routept_city_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `routept_city_page_${page + 1}` }]);
        ctx.session.city_page = page;
        await ctx.editMessageText('Выберите город:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('routept_city_')) {
        const idx = parseInt(data.replace('routept_city_', ''), 10) + (ctx.session.city_page || 0) * pageSize;
        const city = cities[idx];
        if (!city) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        await knex('route_points').where('id', ctx.session.selected_point.id).update({ city_id: city.id });
        await ctx.reply('Город точки маршрута обновлён!');
        ctx.session.state = null;
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Изменение порядка точки маршрута
    if (ctx.session.state === 'routept_edit_point_order' && ctx.message && ctx.message.text) {
      const order = parseInt(ctx.message.text, 10) - 1;
      if (isNaN(order) || order < 0) {
        await ctx.reply('Введите корректное число (от 1 и выше).');
        return;
      }
      await knex('route_points').where('id', ctx.session.selected_point.id).update({ order });
      await ctx.reply('Порядок точки маршрута обновлён!');
      ctx.session.state = null;
      return;
    }

    // --- ГОРОДА ---
    if (ctx.message && ctx.message.text === 'Города') {
      // Показать список городов с пагинацией
      const cities = await knex('cities').orderBy('name', 'asc');
      if (!cities.length) {
        await ctx.reply('Список городов пуст.', {
          reply_markup: { inline_keyboard: [[{ text: 'Добавить город', callback_data: 'add_city' }]] }
        });
        ctx.session.state = 'cities_menu';
        return;
      }
      const page = 0;
  // ...existing code...
      const totalPages = Math.ceil(cities.length / pageSize);
      const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `city_${i}` }]);
      if (totalPages > 1) buttons.push([{ text: 'Далее ▶️', callback_data: 'city_page_1' }]);
      buttons.push([{ text: 'Добавить город', callback_data: 'add_city' }]);
      ctx.session.cities = cities;
      ctx.session.city_page = 0;
      ctx.session.state = 'cities_menu';
      await ctx.reply('Список городов:', { reply_markup: { inline_keyboard: buttons } });
      return;
    }

    // Пагинация по городам
    if (ctx.session.state === 'cities_menu' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const pageSize = 10;
      if (data === 'add_city') {
        ctx.session.state = 'add_city_name';
        await ctx.reply('Введите название нового города:');
        return;
      }
      if (data.startsWith('city_page_')) {
        const page = parseInt(data.replace('city_page_', ''), 10);
        const cities = ctx.session.cities;
        const totalPages = Math.ceil(cities.length / pageSize);
        const showCities = cities.slice(page * pageSize, (page + 1) * pageSize);
        const buttons = showCities.map((c, i) => [{ text: c.name, callback_data: `city_${i}` }]);
        if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `city_page_${page - 1}` }]);
        if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `city_page_${page + 1}` }]);
        buttons.push([{ text: 'Добавить город', callback_data: 'add_city' }]);
        ctx.session.city_page = page;
        await ctx.editMessageText('Список городов:', { reply_markup: { inline_keyboard: buttons } });
        return;
      }
      if (data.startsWith('city_')) {
        const idx = parseInt(data.replace('city_', ''), 10) + (ctx.session.city_page || 0) * pageSize;
        const city = ctx.session.cities[idx];
        if (!city) {
          await ctx.answerCbQuery('Некорректный выбор.');
          return;
        }
        ctx.session.selected_city = city;
        ctx.session.state = 'city_action_menu';
        await ctx.editMessageText(`Город: ${city.name}\nРегион: ${city.region || '-'}\nID: ${city.id}\nАктивен: ${city.is_active ? 'Да' : 'Нет'}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Изменить', callback_data: 'edit_city' },
                { text: city.is_active ? 'Деактивировать' : 'Активировать', callback_data: 'toggle_city' },
                { text: 'Удалить', callback_data: 'delete_city' }
              ],
              [
                { text: 'Назад', callback_data: 'back_to_cities' }
              ]
            ]
          }
        });
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Действия над городом
    if (ctx.session.state === 'city_action_menu' && ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const city = ctx.session.selected_city;
      if (!city) {
        await ctx.answerCbQuery('Город не найден.');
        return;
      }
      if (data === 'edit_city') {
        ctx.session.state = 'edit_city_name';
        await ctx.reply('Введите новое название города:');
        return;
      }
      if (data === 'toggle_city') {
        await knex('cities').where('id', city.id).update({ is_active: !city.is_active });
        city.is_active = !city.is_active;
        await ctx.reply(`Город теперь ${city.is_active ? 'активен' : 'деактивирован'}.`);
        ctx.session.state = null;
        return;
      }
      if (data === 'delete_city') {
        await knex('cities').where('id', city.id).delete();
        await ctx.reply('Город удалён.');
        ctx.session.state = null;
        return;
      }
      if (data === 'back_to_cities') {
        ctx.session.state = null;
        await ctx.reply('Возврат к списку городов. Нажмите "Города" в меню.');
        return;
      }
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    // Добавление города
    if (ctx.session.state === 'add_city_name' && ctx.message && ctx.message.text) {
      const name = ctx.message.text.trim();
      if (!name) {
        await ctx.reply('Название не может быть пустым.');
        return;
      }
      await knex('cities').insert({ name });
      await ctx.reply('Город добавлен!');
      ctx.session.state = null;
      return;
    }

    // Редактирование города
    if (ctx.session.state === 'edit_city_name' && ctx.message && ctx.message.text) {
      const name = ctx.message.text.trim();
      if (!name) {
        await ctx.reply('Название не может быть пустым.');
        return;
      }
      await knex('cities').where('id', ctx.session.selected_city.id).update({ name });
      await ctx.reply('Название города обновлено!');
      ctx.session.state = null;
      return;
    }

      await next();
    } catch (err) {
      console.error('Admin error:', err);
      try {
        await ctx.reply('Произошла ошибка. Попробуйте еще раз или обратитесь к администратору.');
      } catch (e) {}
    }
  }
}

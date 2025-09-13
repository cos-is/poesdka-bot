import { showDriverMenu } from '../common.mjs'

// Управление автомобилями водителя
export async function handleDriverCars(ctx, next, knex) {
  const callbackQuery = ctx?.update?.callback_query;
  // Главное меню "Мои автомобили"
  // console.log(ctx)
  const message = ctx?.session.previousMessage || ctx.message
  if (message && message.text === 'Мои автомобили') {
    // ...existing code...
    const cars = await knex('cars').where('user_id', ctx.session.user.id).orderBy('is_default', 'desc').orderBy('id', 'asc');
    if (!cars.length) {
      await ctx.reply('У вас нет добавленных автомобилей. Нажмите "Добавить авто" ниже.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Добавить авто', callback_data: 'add_car' }]
          ]
        }
      });
      ctx.session.state = 'car_manage_keyboard';
      return true;
    }
    const page = 0;
    const pageSize = 10;
    const totalPages = Math.ceil(cars.length / pageSize);
    const showCars = cars.slice(page * pageSize, (page + 1) * pageSize);
    const buttons = showCars.map((c, i) => [{
      text: `${c.brand} ${c.model} (${c.license_plate})${c.is_default ? ' ⭐️' : ''}`,
      callback_data: `car_${i}`
    }]);
    if (totalPages > 1) {
      buttons.push([{ text: 'Далее ▶️', callback_data: `car_page_${page + 1}` }]);
    }
    buttons.push([{ text: 'Добавить авто', callback_data: 'add_car' }]);
    ctx.session.cars = cars;
    ctx.session.car_page = 0;
    ctx.session.state = 'car_manage_keyboard';
    await ctx.reply('Ваши автомобили:', {
      reply_markup: { inline_keyboard: buttons }
    });
    return true;
  }
  // Обработка инлайн-клавиатуры управления авто
  console.log('car_manage_keyboard', ctx.session.state, callbackQuery?.data)
  if ((ctx.session.state === 'car_manage_keyboard'|| ctx.session.state === 'awaiting_add_car_for_trip') && callbackQuery) {
    const data = callbackQuery?.data;
    const pageSize = 10;
    if (data === 'add_car' || data === 'add_car_for_trip_creation') {
      console.log('ADD CAR', data)
      ctx.session.state = 'add_car_brand';
      await ctx.reply('Введите марку автомобиля:');
      if (data === 'add_car_for_trip_creation') {
        ctx.session.creating_trip_after_car = true
      }
      return true;
    }
    if (data.startsWith('car_page_')) {
      const page = parseInt(data.replace('car_page_', ''), 10);
      const cars = ctx.session.cars;
      const totalPages = Math.ceil(cars.length / pageSize);
      const showCars = cars.slice(page * pageSize, (page + 1) * pageSize);
      const buttons = showCars.map((c, i) => [{
        text: `${c.brand} ${c.model} (${c.license_plate})${c.is_default ? ' ⭐️' : ''}`,
        callback_data: `car_${i}`
      }]);
      if (page > 0) buttons.push([{ text: '◀️ Назад', callback_data: `car_page_${page - 1}` }]);
      if (page < totalPages - 1) buttons.push([{ text: 'Далее ▶️', callback_data: `car_page_${page + 1}` }]);
      buttons.push([{ text: 'Добавить авто', callback_data: 'add_car' }]);
      ctx.session.car_page = page;
      await ctx.editMessageText('Ваши автомобили:', {
        reply_markup: { inline_keyboard: buttons }
      });
      return true;
    }
    if (data.startsWith('car_')) {
      const idx = parseInt(data.replace('car_', ''), 10) + (ctx.session.car_page || 0) * pageSize;
      const car = ctx.session.cars && ctx.session.cars[idx];
      if (!car) {
        await ctx.answerCbQuery('Некорректный выбор.');
        return true;
      }
      ctx.session.selected_car = car;
      ctx.session.state = 'car_action_keyboard';
      await ctx.editMessageText(
        `Авто: ${car.brand} ${car.model}\nЦвет: ${car.color || '-'}\nНомер: ${car.license_plate}\n${car.is_default ? 'По умолчанию' : ''}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Изменить', callback_data: 'edit_car' },
                { text: 'Удалить', callback_data: 'delete_car' }
              ],
              [
                { text: car.is_default ? '⭐️ По умолчанию' : 'Сделать по умолчанию', callback_data: 'set_default_car' }
              ],
              [
                { text: 'Назад', callback_data: 'back_to_cars' }
              ]
            ]
          }
        }
      );
      return true;
    }
    await ctx.answerCbQuery('Некорректное действие.');
    return true;
  }
  // --- Действия над авто (изменить, удалить, сделать по умолчанию) ---
  if (ctx.session.state === 'car_action_keyboard' && callbackQuery) {
    const data = callbackQuery?.data;
    const car = ctx.session.selected_car;
    if (!car) {
      await ctx.answerCbQuery('Авто не найдено.');
      return true;
    }
    if (data === 'edit_car') {
      ctx.session.state = 'edit_car_field';
      await ctx.reply('Что изменить?', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Марка', callback_data: 'edit_brand' },
              { text: 'Модель', callback_data: 'edit_model' }
            ],
            [
              { text: 'Цвет', callback_data: 'edit_color' },
              { text: 'Номер', callback_data: 'edit_plate' }
            ],
            [
              { text: 'Фото', callback_data: 'edit_photo' }
            ],
            [
              { text: 'Назад', callback_data: 'back_to_car' }
            ]
          ]
        }
      });
      return true;
    }
    if (data === 'delete_car') {
      // Проверка: авто не должно быть в активных поездках
      const activeTrips = await knex('trips').where('car_id', car.id);
      if (activeTrips.length) {
        await ctx.answerCbQuery('Нельзя удалить авто, используемое в активных поездках.');
        return true;
      }
      await knex('cars').where('id', car.id).delete();
      await ctx.reply('Автомобиль удалён.');
      ctx.session.state = null;
      return true;
    }
    if (data === 'set_default_car') {
      await knex('cars').where('user_id', ctx.session.user.id).update({ is_default: false });
      await knex('cars').where('id', car.id).update({ is_default: true });
      await ctx.reply('Автомобиль установлен по умолчанию.');
      ctx.session.state = null;
      return true;
    }
    if (data === 'back_to_cars') {
      ctx.session.state = null;
      await ctx.reply('Возврат к списку авто.');
      return true;
    }
    await ctx.answerCbQuery('Некорректное действие.');
    return true;
  }
  // --- Обработка выбора поля для редактирования авто ---
  if (ctx.session.state === 'edit_car_field' && callbackQuery) {
    const data = callbackQuery?.data;
    if (data === 'edit_brand') {
      ctx.session.state = 'edit_car_brand';
      await ctx.reply('Введите новую марку:');
      return true;
    }
    if (data === 'edit_model') {
      ctx.session.state = 'edit_car_model';
      await ctx.reply('Введите новую модель:');
      return true;
    }
    if (data === 'edit_color') {
      ctx.session.state = 'edit_car_color';
      await ctx.reply('Введите новый цвет:');
      return true;
    }
    if (data === 'edit_plate') {
      ctx.session.state = 'edit_car_plate';
      await ctx.reply('Введите новый номер:');
      return true;
    }
    if (data === 'edit_photo') {
      ctx.session.state = 'edit_car_photo';
      await ctx.reply('Отправьте фото автомобиля одним сообщением.');
      return true;
    }
    if (data === 'back_to_car') {
      ctx.session.state = 'car_action_keyboard';
      await ctx.reply('Возврат к авто.');
      return true;
    }
    await ctx.answerCbQuery('Некорректное действие.');
    return true;
  }
  // --- Добавление авто: пошаговый ввод ---
  if (ctx.session.state === 'add_car_brand' && message && message.text) {
    ctx.session.new_car = { brand: message.text };
    ctx.session.state = 'add_car_model';
    await ctx.reply('Введите модель автомобиля:');
    return true;
  }
  if (ctx.session.state === 'add_car_model' && message && message.text) {
    ctx.session.new_car.model = message.text;
    ctx.session.state = 'add_car_color';
    await ctx.reply('Введите цвет автомобиля:');
    return true;
  }
  if (ctx.session.state === 'add_car_color' && message && message.text) {
    ctx.session.new_car.color = message.text;
    ctx.session.state = 'add_car_plate';
    await ctx.reply('Введите номер автомобиля:');
    return true;
  }
  if (ctx.session.state === 'add_car_plate' && message && message.text) {
    ctx.session.new_car.license_plate = message.text;
    ctx.session.state = 'add_car_photo_optional';
    await ctx.reply('Отправьте фото автомобиля одним сообщением или нажмите "Пропустить".', {
      reply_markup: {
        keyboard: [["Пропустить"]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return true;
  }
  // --- Ожидание фото для нового авто (опционально) ---
  if (ctx.session.state === 'add_car_photo_optional') {
    let isCarAdded = false
    // Если пользователь отправил фото
    if (message && message.photo) {
      const photo = message.photo[message.photo.length - 1];
      ctx.session.new_car.photo_url = photo.file_id;
      // Сохраняем авто в БД
      const car = ctx.session.new_car;
      isCarAdded = await knex('cars').insert({
        user_id: ctx.session.user.id,
        brand: car.brand,
        model: car.model,
        color: car.color,
        license_plate: car.license_plate,
        photo_url: car.photo_url
      });
      const afterKeyboard = ctx.session.creating_trip_after_car ? {
        reply_markup: {
          keyboard: [["Отмена"]],
          resize_keyboard: true
        }
      } : {}
      await ctx.reply('Автомобиль добавлен', afterKeyboard);
      // Если был сценарий создания поездки — сбрасываем state, trips.mjs подхватит и продолжит создание
      if (ctx.session.creating_trip_after_car) {
        ctx.session.state = 'create_new_trip';
        console.log('set state', ctx.session.state)
        ctx.session.creating_trip_after_car = false
      } else {
        ctx.session.state = null;
        await showDriverMenu(ctx)
        return true
      }
      ctx.session.new_car = null;
    }
    // Если пользователь нажал "Пропустить"
    console.log('proceed', ctx.session.creating_trip_after_car)
    if (message && message.text === 'Пропустить') {
      const car = ctx.session.new_car;
      isCarAdded = await knex('cars').insert({
        user_id: ctx.session.user.id,
        brand: car.brand,
        model: car.model,
        color: car.color,
        license_plate: car.license_plate,
        photo_url: null
      });
      const afterKeyboard = ctx.session.creating_trip_after_car ? {
        reply_markup: {
          keyboard: [["Отмена"]],
          resize_keyboard: true
        }
      } : {}
      await ctx.reply('Автомобиль добавлен!', afterKeyboard);
      if (ctx.session.creating_trip_after_car) {
        ctx.session.state = 'create_new_trip';
        console.log('set state', ctx.session.state)
        ctx.session.creating_trip_after_car = false
      } else {
        ctx.session.state = null;
        await showDriverMenu(ctx)
        return true;
      }
      ctx.session.new_car = null;
    }
    // Если другое сообщение — просим отправить фото или нажать "Пропустить"
    console.log('proceed next')
    if (message && message.text && !isCarAdded) {
      await ctx.reply('Пожалуйста, отправьте фото автомобиля или нажмите "Пропустить".');
      return true;
    }
  }
  // --- Редактирование фото авто ---
  console.log('proceed next 2')
  if (ctx.session.state === 'edit_car_photo' && message && message.photo) {
    const photo = message.photo[message.photo.length - 1];
    await knex('cars').where('id', ctx.session.selected_car.id).update({ photo_url: photo.file_id });
    await ctx.reply('Фото автомобиля обновлено!');
    ctx.session.state = null;
    return true;
  }
  // --- Редактирование других полей авто ---
  if (ctx.session.state === 'edit_car_brand' && message && message.text) {
    await knex('cars').where('id', ctx.session.selected_car.id).update({ brand: message.text });
    await ctx.reply('Марка обновлена!');
    ctx.session.state = null;
    return true;
  }
  if (ctx.session.state === 'edit_car_model' && message && message.text) {
    await knex('cars').where('id', ctx.session.selected_car.id).update({ model: message.text });
    await ctx.reply('Модель обновлена!');
    ctx.session.state = null;
    return true;
  }
  if (ctx.session.state === 'edit_car_color' && message && message.text) {
    await knex('cars').where('id', ctx.session.selected_car.id).update({ color: message.text });
    await ctx.reply('Цвет обновлён!');
    ctx.session.state = null;
    return true;
  }
  if (ctx.session.state === 'edit_car_plate' && message && message.text) {
    await knex('cars').where('id', ctx.session.selected_car.id).update({ license_plate: message.text });
    await ctx.reply('Номер обновлён!');
    ctx.session.state = null;
    return true;
  }
  console.log('next')
  next()
}

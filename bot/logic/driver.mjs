// Логика для водителя


import { handleDriverCars } from './driver/cars.mjs';
import { handleDriverTrips } from './driver/trips.mjs';
import { handleDriverMenu } from './driver/menu.mjs';

export function driverLogic(knex) {
  return async (ctx, next) => {
    if (ctx?.session?.user?.role !== 'driver') {
      next()
      return
    }
    console.log('driver logic')
    try {
      // --- Главное меню ---
      if (await handleDriverMenu(ctx, next, knex)) return;
      // --- Управление автомобилями ---
      if (await handleDriverCars(ctx, next, knex)) return;
      // --- Поездки ---
      if (await handleDriverTrips(ctx, next, knex)) return;
      // ...other driver-specific logic...
    } catch (error) {
      console.error('Error in driverLogic:', error);
      await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
      return;
    }
  };
}

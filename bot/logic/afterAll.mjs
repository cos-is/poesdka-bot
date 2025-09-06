import { Markup } from 'telegraf'

// Общая логика: приветствие, регистрация, выбор роли
export function afterAll(knex) {
  return async (ctx, next) => {
    console.log('after all')
  };
}

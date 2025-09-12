import { Telegraf, session } from 'telegraf';
import db from '../../db/db.mjs';
import { adminLogic } from './logic/admin.mjs';

const bot = new Telegraf(process.env.ADMIN_BOT_TOKEN);
bot.use(session());
// Доступ только для указанных telegram_id
const ALLOWED_ADMINS = new Set([60440713, 639335311]);
bot.use(async (ctx, next) => {
	const fromId = ctx?.from?.id;
	if (!ALLOWED_ADMINS.has(fromId)) {
		try {
			if (ctx.callbackQuery) {
				await ctx.answerCbQuery('Доступ запрещён');
			}
			if (ctx.message) {
				await ctx.reply('Доступ запрещён.');
			}
		} catch {}
		return; // не пропускаем дальше
	}
	return next();
});
bot.use(adminLogic(db));

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

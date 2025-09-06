import { Telegraf, session } from 'telegraf';
import db from '../../db/db.mjs';
import { adminLogic } from './logic/admin.mjs';

const bot = new Telegraf(process.env.ADMIN_BOT_TOKEN);
bot.use(session());
bot.use(adminLogic(db));

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

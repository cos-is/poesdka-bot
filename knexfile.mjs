import dotenv from 'dotenv'
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '/.env') })
/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
export default {
  client: 'mysql',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: process.env.DB_PORT,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: 'UTC'
  },
  migrations: {
    directory: './db/migrations',
    extension: 'mjs',
    loadExtensions: ['.mjs']
  },
  seeds: {
    extension: 'mjs',
    loadExtensions: ['.mjs']
  }
}
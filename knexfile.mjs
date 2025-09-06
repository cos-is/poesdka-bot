import dotenv from 'dotenv'
dotenv.config()
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
import knex from 'knex'
import knexFile from '../knexfile.mjs'
console.log(knexFile)

export default knex(knexFile)
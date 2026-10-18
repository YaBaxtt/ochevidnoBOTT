import { start } from './server.js';

// Always isolated: never connect a real bot or a database from .env in preview.
await start({ env:'development', port:Number(process.env.PORT||3000), demo:true, botToken:'', databaseUrl:'', publicAppUrl:'', supportUrl:'', toncenterApiKey:'', adminIds:new Set() });

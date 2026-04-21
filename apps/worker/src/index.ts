import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

console.log('Worker financeiro inicializado.');
console.log('Fila de processamento do WhatsApp será conectada ao Redis na próxima etapa.');

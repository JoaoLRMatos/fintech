// Fallback de SPA para hosts estáticos (Render): copia index.html -> 404.html.
// Quando o usuário dá F5 numa rota client-side (ex.: /projection), o host não
// encontra o arquivo e serve o 404.html — que é o próprio app. O React Router
// então renderiza a rota correta. (O ideal é uma regra de rewrite no painel,
// mas isto garante o funcionamento mesmo sem ela.)
import { copyFileSync, existsSync } from 'node:fs';

const src = 'dist/index.html';
const dest = 'dist/404.html';

if (!existsSync(src)) {
  console.error(`postbuild: ${src} não encontrado — pulei a cópia.`);
  process.exit(0);
}

copyFileSync(src, dest);
console.log(`postbuild: ${dest} criado (fallback SPA).`);

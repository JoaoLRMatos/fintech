# Financeiro SaaS com WhatsApp

Base inicial do sistema de organização financeira com:

- frontend em React + Vite + TailwindCSS
- backend em Node.js + Fastify + TypeScript
- banco principal em PostgreSQL no Supabase
- worker preparado para filas e automações
- webhook pronto para integração com Baileys

## Estrutura

- apps/web: interface web
- apps/api: API principal
- apps/worker: tarefas assíncronas
- packages/shared: tipos e validações compartilhadas

## Rodando localmente

1. Copie .env.example para .env e preencha as credenciais.
2. Instale as dependências com npm install.
3. Rode npm run dev para subir tudo.

## Próximos passos

- conectar Prisma ao Supabase
- implementar autenticação persistente
- CRUD real de transações
- integração inbound com o microserviço Baileys

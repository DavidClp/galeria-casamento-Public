# Galeria Casamento API

API Express + TypeScript que recebe fotos/vídeos, sobe no Cloudflare R2, persiste metadados no PostgreSQL (Prisma) e lista no formato `MediaItem` do frontend.

## Pré-requisitos

1. PostgreSQL acessível via `DATABASE_URL`
2. Bucket R2 na Cloudflare
3. API Token / Access Key com permissão de leitura e escrita no bucket
4. Acesso público ao bucket (Custom Domain ou URL `r2.dev`) → `R2_PUBLIC_URL`
5. CORS no bucket R2 liberando o origin do frontend (para download via `fetch` no browser)

Exemplo de CORS no R2:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

## Setup

```bash
cp .env.example .env
# edite .env com DATABASE_URL e credenciais R2
npm install
npm run db:migrate
npm run dev
```

API em `http://localhost:4000`.

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Dev server com hot reload (`tsx watch`) |
| `npm run build` | Gera Prisma Client e compila TypeScript |
| `npm start` | Roda a build de produção |
| `npm run typecheck` | Verifica tipos sem emitir arquivos |
| `npm run db:migrate` | Cria/aplica migrations no Postgres |
| `npm run db:push` | Empurra o schema sem migration |
| `npm run db:studio` | Abre o Prisma Studio |

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta da API (default `4000`) |
| `DATABASE_URL` | Connection string do PostgreSQL |
| `R2_ACCOUNT_ID` | Account ID da Cloudflare |
| `R2_ACCESS_KEY_ID` | Access Key do R2 |
| `R2_SECRET_ACCESS_KEY` | Secret do R2 |
| `R2_BUCKET` | Nome do bucket |
| `R2_PUBLIC_URL` | Base pública dos objetos (sem barra no final) |
| `CORS_ORIGIN` | Origin do frontend (ex. `http://localhost:3000`) |

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Healthcheck |
| `GET` | `/api/media` | Lista `{ items: MediaItem[] }` |
| `POST` | `/api/media` | Upload multipart: campo `files` (1..N) + `guest` |

## Rodar com o frontend

No frontend (`galeria-casamento`):

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:4000

pnpm dev
```

Em outro terminal:

```bash
cd ../galeria-casamento-api
npm run dev
```

Arquivos ficam no R2 em `gallery/media/{uuid}.{ext}`. Metadados (`guest`, `src`, `type`) ficam na tabela `media` no Postgres.

# Card Sort

A self-hosted UX card sort research tool. Create open, closed or hybrid card sort studies, share a
link with participants, watch boards fill in as they drag cards into groups, and analyse the
results (similarity matrix, placement matrix, dendrogram).

- Requirements: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- Design: [`docs/DESIGN.md`](docs/DESIGN.md)
- Contributor / agent guide: [`AGENTS.md`](AGENTS.md)

## Run with Docker (recommended)

You need Docker with the Compose plugin.

1. Create your config file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:
   - `ADMIN_EMAIL`: the email you'll log in with.
   - `SESSION_SECRET`: at least 32 random characters, e.g. the output of `openssl rand -hex 32`.
   - `PUBLIC_BASE_URL`: the address participants will use, e.g. `https://cardsort.example.com`.
     It is used to build the share links.

3. Build the image and generate your admin password hash. Paste the printed
   `ADMIN_PASSWORD_HASH=b64:…` line into `.env`:

   ```bash
   docker compose build
   ```

   ```bash
   docker compose run --rm --no-deps cardsort node scripts/hash-password.mjs 'your-password'
   ```

4. Start it:

   ```bash
   docker compose up -d
   ```

Open `http://localhost:3000/admin` and log in. To use another host port, set `CARDSORT_PORT`
(e.g. `CARDSORT_PORT=8080 docker compose up -d`).

**Data:** the SQLite database lives in the Docker volume `cardsort-data` (mounted at `/data` in
the container). Database migrations run automatically when the container starts, so upgrading is:

```bash
git pull && docker compose up -d --build
```

**Backups:** the database is a single file. A consistent copy can be taken while the app runs:

```bash
docker compose exec cardsort node -e "new (require('better-sqlite3'))('/data/cardsort.db').backup('/data/backup.db').then(()=>console.log('ok'))"
```

```bash
docker compose cp cardsort:/data/backup.db ./cardsort-backup.db
```

**HTTPS:** run it behind a reverse proxy (Caddy, nginx, Traefik) that terminates TLS and forwards to
port 3000. The proxy should set `X-Forwarded-For`, which the login rate limiter relies on.

**Logs and status:** `docker compose logs -f`, `docker compose ps` (the container reports
`healthy` once it's serving).

## Run without Docker

Node.js 20.9+ required.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run hash-password -- 'your-password'
```

Paste the printed line into `.env` and fill in the other values, then:

```bash
npm run db:migrate
```

```bash
npm run build && npm run start
```

For development, use `npm run dev` instead (and optionally `npm run db:seed` for sample studies).
See [`AGENTS.md`](AGENTS.md) for all commands and the test setup.

# Twake Pages

Wikis for Twake Workplace.

## Run it

You need Node 24 and Docker.

```bash
npm ci
docker compose up -d
cp apps/backend/.env.example apps/backend/.env
```

Fill in `OIDC_CLIENT_SECRET` in `apps/backend/.env`, then put your SSO settings in `apps/frontend/public/.env.js`:

```js
var SSO_BASE_URL = 'https://sign-up.twake.app/'
var SSO_CLIENT_ID = 'twakepages'
var SSO_SCOPE = 'openid email profile workplaceFqdn'
var SSO_REDIRECT_URI = 'http://localhost:3400/auth/callback'
var SSO_POST_LOGOUT_REDIRECT = 'http://localhost:3400/'
```

The `workplaceFqdn` scope names the person's Twake Workplace platform, which shows its top bar once it accepts the app's SSO client for token exchange. Without it the app shows its own header.

Start the backend and the frontend, and open http://localhost:3400.

```bash
npm run dev -w @twake-pages/backend
npm run dev -w @twake-pages/frontend
```

The backend refuses to connect to the database as a superuser, because a superuser skips the row level security that keeps organizations apart. Compose creates a `twake_pages` role for it on a fresh volume. If your volume predates that, recreate it with `docker compose down -v`.

Run `npm run check` before you push. It's what CI runs.

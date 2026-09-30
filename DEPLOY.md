# Putting TeamOS online (free)

Two free accounts, about 15 minutes. Your team then opens one link and signs in from anywhere.

- **Neon** — the database (free tier, no card needed)
- **Vercel** — runs the app (free Hobby plan, no card needed)

> Vercel's free Hobby plan is meant for personal, non-commercial projects. It works fine for an internal tool; if this becomes a proper business system, move to Vercel Pro ($20/month). Neon's free tier has no such restriction.

---

## 1. Database on Neon

1. Sign up at **https://neon.tech** (GitHub login is easiest).
2. **Create project** → name it `teamos` → pick the region closest to you (Singapore or Mumbai for India).
3. On the **Connect** panel, copy **two** strings:
   - **Pooled** — the host has `-pooler` in it. This is `DATABASE_URL`.
   - **Direct** — the same string *without* `-pooler`. This is `DIRECT_URL`.

   ```
   pooled : postgresql://neondb_owner:xxx@ep-cool-name-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   direct : postgresql://neondb_owner:xxx@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   The app runs through the pooled one; database migrations need the direct one.

## 2. Point your computer at it

Open `.env` in the project folder and set all three values:

```bash
DATABASE_URL="…pooled string…"
DIRECT_URL="…direct string…"
AUTH_SECRET="…generate it with the command below…"
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create the tables, the application role, then your own account:

```bash
npx prisma migrate deploy
npx tsx scripts/create-app-role.ts   # see the warning below — this is required
npm run db:seed
npm test                             # proves the tenant boundary actually holds
npm run dev                          # http://localhost:3000
```

> **The application must not connect as the database owner.**
>
> Neon's default role (`neondb_owner`) carries `BYPASSRLS`, which overrides even
> `FORCE ROW LEVEL SECURITY`. Connect as that role and every isolation policy is
> enabled, forced, correct — and completely inert. The Stage 0 test suite caught
> exactly this.
>
> `scripts/create-app-role.ts` creates a `teamos_app` role with no BYPASSRLS and
> no ownership, and rewrites your local `DATABASE_URL` to use it. Run it once per
> database — local, staging and production each need their own.
>
> After running it, **copy the new `DATABASE_URL` from `.env` into your hosting
> provider** and leave `DIRECT_URL` as the owner connection, which migrations
> need. `npm test` fails loudly if this is ever wrong.

## 3. Push the code to GitHub

```bash
git add -A
git commit -m "TeamOS"
```

Create an empty **private** repo at **https://github.com/new**, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/teamos.git
git branch -M main
git push -u origin main
```

`.env` is in `.gitignore`, so your database password and secret never leave your machine.

## 4. Deploy on Vercel

1. Sign up at **https://vercel.com** with the same GitHub account.
2. **Add New → Project** → import the `teamos` repo.
3. Before clicking Deploy, open **Environment Variables** and add all three:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **app-role** pooled string from `.env` (starts `postgresql://teamos_app:…`) |
   | `DIRECT_URL` | the owner direct string — migrations need it |
   | `AUTH_SECRET` | generate a **new** one with the command above |

4. **Deploy**. You get a link like `https://teamos-xyz.vercel.app`.

The build runs `prisma migrate deploy` for you, so the tables are created automatically. Every `git push` from now on redeploys.

## 5. Add your team

Open the Vercel link, sign in with the account from step 2, then **Settings → Team → Add member** for each person: name, email, role, and a temporary password to share with them.

- **Manager** — sees money (Transactions, Clients, Salaries, Reports) and everyone's tasks
- **Member** — sees only their own tasks; the money screens don't even appear

---

## Things worth knowing

- **HTTPS is automatic** on Vercel, which the login cookie requires in production.
- **Neon's free database sleeps** after a few minutes of no use; the next request wakes it in a second or two. Storage is 0.5 GB — years of data for a team this size.
- **Backups:** Neon keeps point-in-time history on the free plan. For your own copy, use the **Export** buttons (Tasks, Salaries, Transactions → CSV).
- **Changing `AUTH_SECRET` signs everyone out** — the fastest way to force a fresh login for the whole team.
- **Custom domain:** Vercel → Project → Settings → Domains, e.g. `teamos.yourcompany.com`.
- **Local and production now share one database.** When you want them separate, create a second branch in Neon and use its two strings in your local `.env`.
- **If a deploy fails**, check the Vercel build log — nine times out of ten it's a missing or mistyped environment variable.

## Receipts: object storage

Attachments are optional. Without a bucket configured everything else works and
the receipts panel says storage is not set up, rather than failing at the moment
somebody tries to upload.

It speaks the S3 API, so R2, B2, MinIO or AWS all work. **Cloudflare R2** is the
one to pick on a free tier: 10 GB of storage free, and no charge for egress at
all — for a pile of receipt PDFs, egress is the whole cost everywhere else.

1. Cloudflare dashboard → R2 → **Create bucket**. Name it `teamos-receipts`.
2. R2 → **Manage API tokens** → *Create API token*, permission **Object Read &
   Write**, scoped to that one bucket.
3. Copy the Access Key ID, the Secret Access Key, and the S3 endpoint — it looks
   like `https://<account-id>.r2.cloudflarestorage.com`.
4. Add four variables in Vercel → Settings → Environment Variables:

```
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=teamos-receipts
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

`S3_REGION` is optional and defaults to `auto`, which is what R2 wants.

**Leave the bucket private.** Nothing needs public access: the browser uploads
and downloads through presigned URLs that this application mints per request and
that expire in five minutes. A public bucket would make every receipt readable
by anyone who learns a key.

Files go up from the browser straight to the bucket and never pass through the
server — a 10 MB PDF routed through a serverless function spends that function's
whole memory budget carrying bytes it does nothing with.

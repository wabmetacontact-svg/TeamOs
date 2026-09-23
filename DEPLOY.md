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

Create the tables, then your own account:

```bash
npx prisma migrate deploy
npm run db:fresh -- --name "Samir" --email samirthakur024@gmail.com --password "your password"
npm run dev        # check http://localhost:3000 and sign in
```

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
   | `DATABASE_URL` | the pooled Neon string |
   | `DIRECT_URL` | the direct Neon string |
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

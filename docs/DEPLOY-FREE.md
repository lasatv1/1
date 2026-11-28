# Shipping Ruster Ball for $0

| | Credit card? | Always online | Database | Live push updates |
|---|---|---|---|---|
| **1. GitHub Pages + Actions + Neon** (recommended) | **No** | Yes | Neon Postgres + PostGIS | No: data refreshes hourly |
| **2. Your own PC + Tailscale Funnel** | **No** | Only while your PC is on | Full stack (PostGIS, Redis) | Yes |
| **3. Oracle Cloud Always Free VM** | Yes (verification only) | Yes | Full stack (PostGIS, Redis) | Yes |

> Free tiers change. The terms below were checked in **November 2026**. Confirm them on the provider pages before you rely on them.

---

## 1. No card, always online: GitHub Pages + GitHub Actions + Neon

```
 every hour, GitHub Actions (free):
   sync the feeds ──► Neon Postgres (free, keeps history)
   export a snapshot (JSON) ──► build the site ──► GitHub Pages (free, global CDN)

 visitors ──► https://<you>.github.io/<repo>/   (static files; nothing sleeps, nothing to hack)
```

There is no API server to keep running. The worker runs on a schedule inside GitHub Actions, and the site plus its data are static files on GitHub's CDN, which is free and also does the job of the cache.

What you give up compared with the full stack:
- data refreshes hourly (adjustable) instead of pushing live updates;
- per-country RIPEstat lookups (they need the API);
- the PostGIS lookup endpoint.

### What you need
- A **GitHub** account. Free, no card. The repository must be **public**, because free GitHub Pages and unlimited Actions minutes require it. Your keys stay private in Actions secrets.
- A **Neon** account. Free, no card ([neon.com](https://neon.com)). This is optional but recommended: without it, each run only knows what the feeds currently publish, and nothing builds up over time.

### Steps
1. **Neon:**
   - sign up and create a project;
   - copy the **connection string**; it must end with `?sslmode=require`.

   The first run creates PostGIS, every table and the country borders automatically.
2. **GitHub repository:** push this project to a new public repository, keeping the secret files out. `.gitignore` already excludes `.env`, `backend/db/.db_*` and `backups/`; check `git status` before you push.
3. **Add the workflow:** copy `deploy/github-pages-workflow.yml` to `.github/workflows/pages.yml`, then commit and push.
4. **Turn on Pages:** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
5. **Secrets:** Settings → Secrets and variables → Actions → *New repository secret*:
   - `CTA_DATABASE_URL`: the Neon connection string;
   - optional, for current data: `CTA_OTX_API_KEY`, `CTA_ABUSEIPDB_API_KEY`, `CTA_ABUSECH_AUTH_KEY`. These services offer free accounts without a card.
6. **Run it:** Actions → *Publish site* → *Run workflow*. After about 3 minutes your site is live at `https://<username>.github.io/<repo>/`.

From then on it refreshes every hour (the `cron` line in the workflow) and on every push.

### Checking on it
- **Actions tab:** every run's log shows `synced <source>: N records, M new` and `snapshot written: N events`.
- **The site:** the top bar says **"Published snapshot"**, and the right panel lists every source with its status and last sync time.
- **Neon console:** browse tables, run SQL and watch storage use.

### Limits to know
- **Neon free plan:** about 1 GB storage per project. History only stores records that *changed*, so normal syncing grows slowly. Lower `CTA_RETENTION_DAYS` (add it as an env line in the workflow) if you ever get close.
- **GitHub pauses scheduled workflows in repositories with no activity for 60 days.** Any push, or a manual run, resumes them.
- **The snapshot holds up to 60,000 observations from the last 365 days.** It is public. That's fine for threat-feed data, but never add private data to it.

---

## 2. No card, full live stack: your own computer + Tailscale Funnel

This runs the complete system (PostGIS, Redis, worker, live updates, backups) on any computer you own: this laptop, an old PC, or a Raspberry Pi 4/5 with 4 GB or more. Tailscale Funnel gives it a public HTTPS address. Tailscale's Personal plan is free for non-commercial use and needs no card.

1. Start the stack as usual (see `docs/OPERATIONS.md`): `./scripts/new-secrets.ps1`, then `docker compose up -d --build`.
2. Install Tailscale and sign in, for example with your GitHub or Google account.
3. Turn on HTTPS certificates and Funnel for your tailnet when the admin console asks, then run:
   ```bash
   tailscale funnel --bg 8080
   ```
4. Your site is now at `https://<machine-name>.<your-tailnet>.ts.net`, with a real certificate and a stable address.

Trade-offs:
- The site is only up while the computer is on and awake (turn off sleep).
- Funnel bandwidth is limited (Tailscale doesn't publish the exact cap). That's fine for a portfolio or demo, not for heavy traffic.
- Funnel only listens on ports 443, 8443 and 10000. The command above maps port 443 to the app.

---

## 3. With a card for verification: Oracle Cloud Always Free VM

If you later get a card (some debit and virtual cards are accepted for verification), Oracle's Always Free Arm VM runs the full stack around the clock. The current allowance is 2 OCPUs and 12 GB RAM; the stack uses about 360 MB. One script sets it up:

```bash
sudo ./deploy/oracle-bootstrap.sh myatlas.duckdns.org
```

Full steps:
1. Create an Ubuntu 24.04 `VM.Standard.A1.Flex` instance.
2. Open TCP 80/443 in its Security List.
3. Get a free DuckDNS subdomain and point it at the VM.
4. Run the script above. It handles Docker, the VM firewall, secrets, the ARM PostGIS image and HTTPS.

Notes:
- Only create resources marked **Always Free-eligible**, and set a $1 budget alert as a tripwire.
- Oracle's policy allows reclaiming Always Free instances that stay nearly idle; check their current wording.
- The ARM PostGIS image (`imresamu/postgis`) is labeled experimental, but it passed the full stack test here.

---

## Sources checked
- [Neon free plan (no card)](https://neon.com/faqs/managed-postgres-databases-free-tier) · [Neon limits](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Tailscale free plans](https://tailscale.com/kb/1154/free-plans)
- [Oracle Always Free resources](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm)
- [Upstash Redis billing (no card)](https://upstash.com/docs/redis/overall/billing). Not needed for option 1, but an option if you later add a free API host.

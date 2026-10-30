# Hosting the site on Vercel, with Google sign-in

Steps only a person can do. They set up the hosted site (v2) as a new project under Moxie's Vercel team, named **feature-workshop** for now. Nothing here is done by Claude: Claude never pushes, deploys or signs in to Vercel or Google.

Do the steps in this order. Steps 1–3 can be done now; step 4 waits until the first v2 packet (2A) is merged and you push `main`.

## What you end up with
- **The address:** `https://feature-workshop.<your domain>`.
- **Sign-in:** Moxie Google sign-in only. The site refuses any account outside your Workspace domain.
- **What the site keeps:**
  - Neon Postgres, from the Vercel Marketplace: users, laptops, mirrored job records, queued approvals and the audit copy.
  - Vercel Blob (private): screenshots and videos from evidence.
- **One cron job:** it fills each person's Orbit inbox every 3 minutes. This needs the team to be on Vercel Pro, because Hobby allows a cron job only once a day.
- **How laptops connect:** each laptop's runner calls the site over HTTPS. It is paired once with a one-time code, from `ground-control login`.

## 1. Google sign-in (Google Cloud Console)
Use a **new Google Cloud project, just for this app.**
- It keeps this app's sign-in apart from Orbit's and anything else Moxie runs, so changing or deleting it can't affect them.
- It costs nothing: sign-in needs no billing account and no APIs switched on.

**1.0 Before you start.** Sign in at console.cloud.google.com with your **Moxie** Google account, not a personal one.
- **Can you create projects?** Open the project picker at the top and choose New Project.
  - If **Location** shows the Moxie organization (or a folder inside it), you're set.
  - If you get "You don't have permission" or see only "No organization", ask Moxie IT (the Workspace admin):
    - to give you the **Project Creator** role on the organization or a folder, or
    - to create the project for you and give you **Owner** on it.
- **Why the organization matters:** the project must sit inside the Moxie organization. Only then can sign-in be set to **Internal**, which limits it to Moxie accounts.

**1.1 Create the project.** New Project:
- **Project name:** `feature-workshop`.
- **Project ID:** Google suggests one. It can never be changed, but nobody sees it, so any ID is fine (for example `feature-workshop-<4 digits>`).
- **Location:** the Moxie organization, or the folder IT uses for internal tools.

Press Create, then make sure the picker at the top shows the new project.

**1.2 Open Google Auth Platform.** Menu → APIs & Services → OAuth consent screen. It opens **Google Auth Platform**. Press **Get started**.
- **App information:**
  - **App name:** `feature-workshop`. This is what people see on Google's "Sign in to …" screen. It can be renamed any time.
  - **User support email:** your email, or a Moxie group you manage.
- **Audience:** **Internal**. If Internal is greyed out, the project isn't in the organization; go back to 1.0.
- **Contact information:** your email. Google writes here about the project.
- Agree to the policy, then press **Create**.

**1.3 Branding** (left menu). Most of it is optional for an Internal app.
- **App logo:** leave it empty for now.
- **App domain** (home page, privacy policy, terms): optional for Internal. Leave it empty.
- **Authorized domains:** add your root domain, the part after `feature-workshop.`, for example `moxie.example`.
  - Google only accepts redirect addresses on domains listed here.
  - A `*.vercel.app` address can't be added, so sign-in works only on your own subdomain, not the Vercel preview address.
- Save.

**1.4 Data access** (left menu): press **Add or remove scopes** and tick only these three:
- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

These are the basic, non-sensitive ones: Google's review isn't needed, and the app never sees email, Drive or calendar. Update, then Save.

**1.5 Create the client.** Clients (left menu) → **Create client**.
- **Application type:** Web application.
- **Name:** `feature-workshop`. Only you see it.
- **Authorized JavaScript origins:**
  - `https://feature-workshop.<your domain>`
  - `http://localhost:4505`, for trying the site on your Mac. Google allows plain `http` only for localhost.
- **Authorized redirect URIs:** exactly these, with no trailing slash:
  - `https://feature-workshop.<your domain>/api/auth/callback`
  - `http://localhost:4505/api/auth/callback`
- Press **Create**.

**1.6 Copy the client ID and secret right away.** Google shows the full **client secret only once**, on the screen that appears after Create. Afterwards the console shows only its last four characters.
- Paste both straight into Vercel's environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; step 2.4). If Vercel isn't set up yet, keep them in your password manager.
- Never put them in chat, a file in the repo or a commit.
- If the secret is lost, open the client, choose **Add secret**, put the new one in Vercel, then disable the old one.

**1.7 Check the Workspace side** (only if sign-in is blocked later). Some Workspace domains block apps their admin hasn't approved.
- If signing in later says "Access blocked" or "This app is blocked", the Workspace admin opens Admin console → Security → Access and data control → API controls → Manage app access.
- There they mark `feature-workshop`, found by its client ID, as **Trusted**, or turn on "Trust internal, domain-owned apps".

**What's fixed and what can change later:**

| Setting | Can it change? |
|---|---|
| Project ID | Never. It doesn't matter, nobody sees it. |
| Project name, app name, client name | Any time. |
| Audience (Internal) | Keep it Internal. |
| Subdomain | When it changes, first add the new origin and redirect URI to the client (1.5) and the new root domain to Authorized domains (1.3) if it differs. Switch the Vercel domain, then remove the old entries. |

The app checks the domain itself too: `ALLOWED_DOMAIN` on Vercel, so a non-Moxie account is refused even if a setting above were wrong.

## 2. The Vercel project (under Moxie's team)
**Assume the name will change.** So:
- Nothing you create here carries the product's name except the project itself and its subdomain, and both can be changed later.
- The storage is named for what it holds: `site-db`, `site-files`.
- The environment variables have neutral names.
- Section 6 covers the rename.

**2.0 Before you start**
- **Your team role:** sign in at vercel.com and switch to the Moxie team (the one Orbit lives in), using the team picker at the top left. You need the **Owner** or **Member** role there to create a project.
- **The plan:** Team → Settings → Billing must say **Pro**. Hobby allows a cron job only once a day.
- **Your GitHub account must be connected to your Vercel user:** Account Settings → Authentication → GitHub. Vercel deploys a private repository's commits only when their author is a member of the team.

**2.1 Create the project.** Add New… → Project.
- **Import Git Repository:** pick `vigneshrs-moxie/feature-workshop`.
  - If it isn't in the list, choose **Adjust GitHub App Permissions**, then on GitHub let Vercel's app see **only this repository**, and come back.
- **Project Name:** `feature-workshop`. It can be renamed later (section 6).
- **Framework Preset:** Other.
- **Root Directory:** press Edit and pick `hosted`.
  - If the folder isn't there yet (2A isn't pushed), type `hosted` anyway, or create the project after the first push.
- **Build and Output Settings:** leave every override off; `hosted/vercel.json` sets them.
- **Environment Variables:** skip for now (2.5).
- Press **Deploy**. Until 2A is pushed, this first build fails with "no hosted folder" or similar. That's expected and harmless.

**2.2 Project settings that matter.** Project → Settings:
- **Build and Deployment:**
  - **Node.js Version:** 22.x.
  - **Root Directory:** `hosted`.
  - **"Include files outside the root directory in the Build Step":** on. The site uses `web/` and `dashboard/lib/`.
- **Environments → Production:** branch `main`.
  - You only push `main`, so there will be no preview deployments in practice.
- **Functions:**
  - **Fluid compute:** on (the default for new projects).
  - **Function Region:** choose one and remember it: the database goes in the same place. Pick where Orbit's functions run, or else **Washington, D.C., USA (iad1)**.

**2.3 The database.** Project → Storage → **Create Database** → **Neon** (Serverless Postgres) → Continue.
- **Region:** the AWS region matching 2.2 (for iad1, **US East 1 (N. Virginia)**).
- **Plan:** Free to start. It's billed through Vercel if you outgrow it.
- **Name:** `site-db`.
- **Connect to the project:** tick **Production** only, leaving Preview and Development unticked, and keep the variable prefix empty. This adds `DATABASE_URL` and a few `PG…` variables.
  - Production only, because the build runs database migrations: a preview deployment must never change the real database.

**2.4 File storage.** Project → Storage → **Create** → **Blob**.
- **Name:** `site-files`.
- **Access:** **Private**. Screenshots and videos are only ever shown to their owner, through short-lived links.
- **Connect to the project:** Production only.
- On Vercel the site reaches a private store with a short-lived token Vercel issues itself, so there's no long-lived Blob key to look after. If Vercel adds a `BLOB_READ_WRITE_TOKEN` variable anyway, leave it.

**2.5 Environment variables.** Project → Settings → Environment Variables.
- Add each one for the **Production** environment only. Mark the secrets **Sensitive**: Vercel then never shows them again, even to you.
- Make each secret on your Mac with `openssl rand -base64 32` in Terminal: one run per secret, never the same value twice.

| Name | Value | Sensitive |
|---|---|---|
| `GOOGLE_CLIENT_ID` | from Google, step 1.6 | no |
| `GOOGLE_CLIENT_SECRET` | from Google, step 1.6 | **yes** |
| `ALLOWED_DOMAIN` | your Workspace domain: the part after @ in your work email | no |
| `SESSION_SECRET` | a new `openssl rand -base64 32` | **yes** |
| `TOKEN_KEY` | a new `openssl rand -base64 32`. Encrypts each person's Orbit token. Also keep a copy in your password manager: if it's lost, everyone pastes their Orbit token again. | **yes** |
| `CRON_SECRET` | a new `openssl rand -base64 32`. Vercel sends it with each cron call and the site refuses calls without it. | **yes** |
| `OWNER_EMAIL` | your work email. Your first sign-in becomes the owner. | no |
| `ORBIT_BASE_URL` | Orbit's production address, for example `https://<orbit's domain>` | no |
| `SITE_URL` | `https://feature-workshop.<your domain>` (this changes with the name, section 6) | no |

Changes to variables apply to the **next** deployment. After editing, go to Deployments → the latest → ⋯ → **Redeploy**.

**2.6 The address.** Project → Settings → **Domains** → Add `feature-workshop.<your domain>`, connected to **Production**.
- If the domain's DNS is managed in this Vercel team (as Orbit's may be), it works within a minute.
- If DNS is elsewhere, Vercel shows one **CNAME** record. Add it at the DNS provider, or ask IT to; it can take up to an hour.
- HTTPS certificates are automatic.
- Ignore the `*.vercel.app` address Vercel also gives the project: Google sign-in won't work on it (step 1.3). Use only your subdomain.

**2.7 Deployment Protection.** Project → Settings → Deployment Protection → **Vercel Authentication: Standard Protection** (usually already on).
- It puts Vercel's own login in front of preview deployments and generated URLs, but **not** in front of your production subdomain.
- That's what is needed: laptops, phones and the cron job must reach production, which has its own Google sign-in.
- Don't choose "All Deployments".

**2.8 Leave alone.** Don't set a team-wide spending cap without asking whoever owns the team's billing: on Pro it applies to every project, Orbit included. If you want a limit for this project alone, ask them first.

**2.9 Cron.** Nothing to set: the schedule comes from `hosted/vercel.json`. After the first good deploy, Project → Settings → **Cron Jobs** should list `/api/cron/inbox` every 3 minutes. Cron calls go to production only.

## 3. Your Orbit token on the site
Once you can sign in, open Settings → Orbit on the site and paste your Orbit read token, as you do locally. The site stores it encrypted with `TOKEN_KEY`, and the inbox then fills while your laptop is off. Sohum does the same with his own token.

## 4. First deploy and pairing (after packet 2A is merged)
1. **Push `main`.** You do this; Claude never pushes. Vercel builds and deploys `hosted/`.
2. **Open the site** and sign in with Google. You become the owner.
3. **On your Mac:**
   - run `ground-control login --site https://feature-workshop.<your domain>`;
   - open the link it prints;
   - confirm the code shown on both sides.

   The laptop is paired, and its jobs show on the site.
4. **On Sohum's Windows laptop:** after the installer, he signs in to the site, then runs the same `login` command.
5. **Check:**
   - Each of you sees only your own jobs.
   - The Lounge (packet 2D) shows you both.

## 5. The final test (v2's finish line)
- **You and Sohum:**
  - each start a job from your own laptop, yours on the Mac and his on Windows;
  - each check that you see only your own.
- **Approve a gate from your phone while your laptop is closed.** The card says "waiting for your laptop". When the laptop wakes, the runner picks the approval up and the job moves on.

## 6. When the name changes
Do it in this order, so nobody is locked out in between:
1. **Vercel → Domains:** add the new subdomain to Production. Keep the old one for now.
2. **Google → Clients → `feature-workshop`:**
   - add the new JavaScript origin and redirect URI (`https://<new>/api/auth/callback`);
   - if the root domain differs, add it under Branding → Authorized domains.
3. **Google → Branding:** change the **App name**.
4. **Vercel:** set `SITE_URL` to the new address, then redeploy.
5. **Vercel → Domains:** edit the **old** subdomain and set it to **Redirect to** the new one (308, permanent). Old links and bookmarks keep working.
6. **Each laptop:** run `ground-control login --site https://<new address>` once to point it at the new address.
7. **Optional:** rename the Vercel project (Settings → General → Project Name) and the Google client and project display names. These are cosmetic: nothing depends on them, and the Google project ID never changes.
8. **A few weeks later:** remove the old redirect URI from Google, and the old domain from Vercel.

The database, the files, the secrets, everyone's sign-in and paired laptops all stay as they are. Nobody has to sign up again.

## Costs to expect
- **Vercel Pro:** the team plan you already pay for. Plus Function time: small, mostly the runners' waiting requests and the 3-minute cron job.
- **Neon:** the free tier is likely enough for three people; it is billed through Vercel if you go past it.
- **Blob:** screenshots and videos only, a few MB per job.

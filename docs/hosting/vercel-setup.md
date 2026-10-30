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
1. **Check the plan:** Team → Settings → Billing should say Pro.
2. **Create the project:** Add New → Project, and import the GitHub repository `vigneshrs-moxie/feature-workshop`.
   - If it isn't listed, choose "Adjust GitHub App permissions" and give Vercel's GitHub app access to that repository.
   - A private repository owned by a personal account can deploy to a team. The commit authors must be members of the Vercel team.
   - **Project name:** `feature-workshop`.
   - **Framework preset:** Other.
   - **Root Directory:** `hosted`. Leave "Include files outside the root directory" on, because the site uses the shared `web/` and `dashboard/lib/` code.
   - **Leave build and output settings empty:** `hosted/vercel.json` sets them.
   - The first deploy fails until 2A is pushed (step 4). That's expected.
3. **Storage:**
   - **Postgres:** project → Storage → Create Database → Neon (Marketplace). Connect it to the project for Production and Preview. This sets `DATABASE_URL` and its friends.
   - **Region:** pick the one closest to Orbit's project. If unsure, use US East (Washington D.C.) for Vercel and AWS us-east-1 for Neon, keeping the two the same.
   - **Blob:** Storage → Create → Blob, as a private store, connected to the project. This sets `BLOB_READ_WRITE_TOKEN`.
4. **Environment variables:** Settings → Environment Variables.

   | Name | Value | Environments |
   |---|---|---|
   | `GOOGLE_CLIENT_ID` | from step 1.5 | Production, Preview |
   | `GOOGLE_CLIENT_SECRET` | from step 1.5 (mark it Sensitive) | Production, Preview |
   | `ALLOWED_DOMAIN` | your Workspace domain, for example the part after @ in your work email | all |
   | `SESSION_SECRET` | the output of `openssl rand -base64 32` (Sensitive) | all |
   | `TOKEN_KEY` | a second, different `openssl rand -base64 32` (Sensitive). It encrypts each person's Orbit token. Losing it means everyone pastes their token again. | all |
   | `CRON_SECRET` | a third `openssl rand -base64 32` (Sensitive) | all |
   | `OWNER_EMAIL` | your work email. The first sign-in with it becomes the owner, who sets roles: Raj manager, you and Sohum members. | all |
   | `ORBIT_BASE_URL` | Orbit's production address | all |
   | `SITE_URL` | `https://feature-workshop.<your domain>` | Production |

   Generate each secret on your Mac in Terminal and paste it in. Don't reuse one value for two names.
5. **Domain:** Settings → Domains → Add `feature-workshop.<your domain>`.
   - If Vercel manages the domain's DNS (as for Orbit), it's done.
   - If not, add the CNAME record Vercel shows, at your DNS provider.
6. **Deployment Protection:** Settings → Deployment Protection.
   - Keep **Vercel Authentication** on for **Preview** deployments only.
   - Production uses the app's own Google sign-in, so it must stay reachable for the runner and the cron job.
7. **Functions:** Settings → Functions.
   - Keep **Fluid compute** on (the default).
   - Set the function region to the same region as the Neon database.

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

## Costs to expect
- **Vercel Pro:** the team plan you already pay for. Plus Function time: small, mostly the runners' waiting requests and the 3-minute cron job.
- **Neon:** the free tier is likely enough for three people; it is billed through Vercel if you go past it.
- **Blob:** screenshots and videos only, a few MB per job.

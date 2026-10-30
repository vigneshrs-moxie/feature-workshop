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
You need to be a Moxie Google Workspace admin, or ask one. Pick the Google Cloud project Moxie uses for internal apps, or create one inside the Moxie organization. It must belong to the organization for step 1.2 to work.

1. **Google Auth Platform → Overview → Get started.**
2. **Branding:**
   - **App name:** `feature-workshop`.
   - **User support email** and **developer contact:** your email.
3. **Audience:** choose **Internal**. Only accounts in Moxie's Workspace can sign in, and Google skips app review.
4. **Data access:** add only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Add nothing else; these need no verification.
5. **Clients → Create client:**
   - **Application type:** Web application.
   - **Name:** `feature-workshop`.
   - **Authorized JavaScript origins:**
     - `https://feature-workshop.<your domain>`
     - `http://localhost:4505`, for trying the site on your Mac.
   - **Authorized redirect URIs:**
     - `https://feature-workshop.<your domain>/api/auth/callback`
     - `http://localhost:4505/api/auth/callback`
6. **Copy the Client ID and Client secret.** Paste them straight into Vercel (step 2.4), never into chat, a file or a commit.

**When the subdomain changes later,** add the new origin and redirect URI to this client before you switch the domain, then remove the old ones.

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

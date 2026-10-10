# English World: one-time setup (free, no credit card)

English World is shared by many students, so it needs a free online database: **Supabase**.
The owner does this **once** (about 15 minutes). After that, every student only pastes two values in the app.

> বাংলা: English World সবার জন্য শেয়ার করা জায়গা, তাই একটা ফ্রি অনলাইন ডাটাবেস (Supabase) লাগবে। এটা শুধু একবার আপনি (মালিক) সেট করবেন। এরপর সব ছাত্রছাত্রী অ্যাপে শুধু দুটো জিনিস পেস্ট করবে।

---

## Step 1: Create a free Supabase project

1. Go to **https://supabase.com** and click **Start your project**.
2. Sign in with **GitHub** (you already have it). No credit card is asked.
3. Click **New project**:
   - **Name:** `english-world`
   - **Database password:** click *Generate*, then save it somewhere safe (you rarely need it).
   - **Region:** *Southeast Asia (Singapore)*, the closest to Bangladesh.
   - **Plan:** Free.
4. Click **Create new project** and wait about 1–2 minutes.

> বাংলা: supabase.com → GitHub দিয়ে Sign in → New project → নাম `english-world`, Region: Singapore, Plan: Free → Create।

## Step 2: Turn on anonymous sign-ins

Students don't need an email or password. The app gives each one an anonymous account.

1. Left menu: **Authentication** → **Sign In / Providers** (or **Providers**).
2. Turn on **Allow anonymous sign-ins** → **Save**.

> বাংলা: Authentication → Sign In / Providers → “Allow anonymous sign-ins” চালু করে Save।

## Step 3: Create the database

1. Left menu: **SQL Editor** → **New query**.
2. Open the file **`supabase/english-world.sql`** from this project folder, copy **everything**, and paste it.
3. Click **Run**. You should see *Success. No rows returned*.

(It is safe to run again later. Existing posts are kept.)

> বাংলা: SQL Editor → New query → `supabase/english-world.sql` ফাইলের সব লেখা কপি করে পেস্ট → Run → “Success” দেখাবে।

## Step 4: Add the safety function (checks every post before it is published)

1. Left menu: **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Function name: **`ew-api`** (exactly this).
3. Delete the sample code. Open **`supabase/functions/ew-api/index.ts`** from this project, copy everything, paste it.
4. Click **Deploy function**.
5. Add your Gemini key as a secret: **Edge Functions** → **Secrets** (or *Manage secrets*) → **Add new secret**:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your Gemini API key (from Google AI Studio). **Type it yourself.**
   - **Save**.
6. Open the `ew-api` function → **Details / Settings**. If you see **“Verify JWT with legacy secret”** (or *Enforce JWT verification*), turn it **OFF** and save. (The function checks the user itself.)

> বাংলা: Edge Functions → Deploy a new function → Via Editor → নাম `ew-api` → `supabase/functions/ew-api/index.ts` এর সব কোড পেস্ট → Deploy। তারপর Secrets-এ `GEMINI_API_KEY` নামে আপনার Gemini key নিজে লিখে Save করুন। “Verify JWT” টগল থাকলে OFF করুন।

## Step 5: Copy the two values for the app

1. Click **Connect** at the top (or **Project Settings → API Keys**).
2. Copy the **Project URL**, which looks like `https://abcdxyz.supabase.co`.
3. Copy the **Publishable key** (starts with `sb_publishable_`), or the legacy **anon public** key (starts with `eyJ`).

**Never** copy the **secret** key or the **service_role** key into the app. The app refuses them anyway.

> বাংলা: উপরের Connect বাটন → Project URL আর Publishable key কপি করুন। Secret বা service_role key কখনো অ্যাপে দেবেন না।

## Step 6: Connect the app

1. In the app, open **English World** (left menu, after Practice).
2. Paste the **Project URL** and the **Publishable key** → **Connect**.
3. Make your profile.
4. **Right away**, click the **shield icon** (Moderator mode) and set a long moderator passcode.
   The first person to set it becomes the moderator, so do it before sharing the app.

> বাংলা: অ্যাপে English World → URL আর key পেস্ট → Connect → প্রোফাইল বানান → সাথে সাথে শিল্ড আইকনে গিয়ে Moderator passcode সেট করুন (যে আগে সেট করবে সেই মডারেটর হবে)।

## Step 7: Students

Students need this app on their computer and the **same Project URL and Publishable key**. You can share those two values.
They should not get the secret key, the database password, or the moderator passcode.

---

## Good to know (free plan)

- **Pausing:** a free project that nobody uses for 7 days is paused. Open supabase.com and click **Restore**. Posts are kept.
- **Space:** 500 MB of database. Photos are compressed to about 100–300 KB each, so that's a few thousand photo posts.
- **Safety checks** use your free Gemini key. If many people post at the same time, some posts may say *“We couldn't check this right now… try again in a minute.”* That's on purpose: nothing is published without a check.
- **Moderator mode is basic:** one shared passcode, checked on the server. Use a long one and don't share it.

## What is protected, and where

| Rule | Where it is enforced |
|---|---|
| Phone numbers, emails, social handles blocked | App (instant), Edge Function, **and** database |
| Bullying / sexual / hate / threats / personal data | Gemini check in the Edge Function, before saving |
| Posts, comments and corrections written only after the check | Database rules: students can't write them directly |
| 3 reports → hidden for everyone | Database trigger |
| Only the post author can mark “Helpful” / “Solved” | Database functions |
| Stories disappear after 24 hours | Database rule (expired stories can't be read) |
| Delete only your own posts and comments | Database rules |
| Rate limits (20 posts, 60 comments per hour) | Database trigger |

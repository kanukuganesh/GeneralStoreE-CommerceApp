# Google Play Publishing Checklist — GS (Greeno)

Everything you must prepare **before** you can publish `com.kanukuganesh.generalstore` on Google Play.

---

## A. One‑time Play Console setup

1. **Google Play Developer account** — one‑time **$25 USD** fee at https://play.google.com/console
   - Verify identity (some regions require ID + address verification; can take days — do this early).
2. **Complete your Play Console profile** — developer name, email, website (optional).
3. Agree to the **Developer Distribution Agreement**.

---

## B. App identity (must match the build)

| Field | Value |
|-------|-------|
| Package name | `com.kanukuganesh.generalstore` (locked once created — cannot change) |
| App name | GS (Greeno) |
| App icon | 512×512 PNG (32‑bit, no transparency) |
| Feature graphic | 1024×500 PNG/JPG |

---

## C. Store listing assets (required)

- **Short description** (max 80 chars) + **Full description** (max 4000 chars).
- **Screenshots:** minimum **2**, recommended 4–8 (phone). Take from the real app (4" phone or 16:9).
- **Feature graphic** 1024×500.
- **App icon** 512×512.
- (Optional) Tablet / Wear screenshots if you declare those form factors.

---

## D. Privacy & data compliance (critical — app gets rejected here most often)

1. **Privacy policy URL** — must be a **publicly accessible URL**.
   - Host `PRIVACY_POLICY.md` (or an HTML version) online, e.g. GitHub Pages, Netlify, your own site.
   - Put the exact URL in Play Console → **Policy and programs → App content → Privacy policy**.
2. **Data safety form** (Play Console → App content → Data safety). Declare:
   - **Personal info:** Name, Phone number, Address — **collected**, **not sold**, **encrypted in transit**, user can request deletion.
   - **Location:** Approximate/Precise location — **collected**, **only when the feature is used (not background)**, **not sold**, optional.
   - **Photos/videos/files:** none.
   - **App activity:** Account info, Orders — collected.
   - State data is **encrypted in transit** and users can **request deletion**.
3. **Permissions declaration** for **Location** (Play Console → App content → Location):
   - Core function: address autofill / map pin for delivery.
   - Justify why **precise** location is needed (delivery accuracy). Keep it accurate to how the app behaves.
4. **Account deletion link/flow** — Google requires an **in‑app account deletion** option.
   - ✅ Already present: **Account → Delete account**. Point the Data safety "data deletion" answer to this in‑app flow.

---

## E. Content ratings

- Complete the **IARC content rating questionnaire** (Play Console → App content → Content ratings).
- A grocery shopping app with no violence/adult content typically rates **Everyone** / **PEGI 3**.
- You must get a rating before publishing.

---

## F. Target audience & families

- **Target age group** — declare (e.g. 18+ since it involves purchases; or "Designed for families: No").
- If not targeting children, set appropriate audience so you avoid extra child‑privacy rules.

---

## G. App access (important for review)

Reviewers must be able to **log in and test** the app, or it can be rejected.

- Provide a **test account**: username `Ganesh` / password `Ganesh@7780` (or create a dedicated reviewer account), **or**
- Set the app to **Internal/Closed testing** first (no public review gate), then move to Production.
- In **App content → App access**, add the login instructions and the demo store state.

---

## H. Build & signing

- Upload the **AAB** (not APK): `android/app/build/outputs/bundle/release/app-release.aab`.
- It is **already signed** with your release keystore (`android/app/gs-release.jks`).
- **Keep the keystore + `key.properties` safe** — required for every future update.
- In Play Console, use **Play App Signing** (recommended): Google re‑signs; you upload your signed AAB.

---

## I. Before you press "Publish" — final checklist

- [ ] Play Console developer account verified ($25 paid, identity confirmed)
- [ ] Package name decided (`com.kanukuganesh.generalstore`)
- [ ] App icon (512) + feature graphic (1024×500) ready
- [ ] 2+ real screenshots added
- [ ] Short + full store description written
- [ ] **Privacy policy hosted at a public URL** and added in Play Console
- [ ] **Data safety form** completed (Personal info + Location, collected/not sold/encrypted/deletion)
- [ ] **Location permission** declaration submitted
- [ ] **Account deletion** flow confirmed (in‑app) and referenced
- [ ] **Content rating** obtained (IARC)
- [ ] **Target audience** set
- [ ] **App access / test login** provided for reviewers
- [ ] Release **AAB** uploaded to a track (start with **Internal → Closed → Production**)
- [ ] Release notes written
- [ ] Final review → **Roll out** to Production

---

## J. Recommended rollout path

1. **Internal testing** — upload AAB, install yourself, verify.
2. **Closed testing** — invite a few testers.
3. **Open testing** (optional) — public beta.
4. **Production** — full release.

---

## Common rejection reasons to avoid

- Privacy policy URL missing, broken, or not matching the Data safety form.
- Data safety form incomplete/inaccurate (especially **Location**).
- No in‑app **account deletion**.
- Reviewers **cannot log in** (no test account provided).
- App **crashes on launch** — always test the release AAB on a real device first.
- Metadata (icon/screenshots) not matching the actual app.

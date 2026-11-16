# 🟢 Setting up the free Google Sheets backend (≈5 minutes)

The website (already online on GitHub Pages) needs one Google Sheet to store the records.
You do this **once**. The Sheet lives in **your** Google Drive — nobody else can open it.

---

## Step 1 — Create the spreadsheet

1. Go to **[sheets.new](https://sheets.new)** (make sure you're signed in to Google).
2. Name it: **Waste Log Data**

## Step 2 — Add the backend code

1. In the spreadsheet: **Extensions → Apps Script**.
2. Delete whatever is in the editor (`function myFunction() {}`).
3. Open the file **`google-apps-script/Code.gs`** from this project folder, copy **all** of it, and paste it into the editor.
4. At the very top of the pasted code, change these two lines:

```js
const ADMIN_EMAIL    = 'you@example.com';   // ← your email
const ADMIN_PASSWORD = 'change-me-123';     // ← your password
```

This becomes your **administrator** sign-in (you can add staff accounts later inside the app).

## Step 3 — Run it once

1. Click **Run** (▶) in the toolbar, choose the function **setup**.
2. It asks for permission: **Review permissions → choose your account →**
   if you see "Google hasn't verified this app", click **Advanced → Go to Waste Log Data (unsafe)** → **Allow**.
   *(This warning is normal — it's YOUR own script for YOUR own sheet.)*
3. You'll see new tabs appear in the spreadsheet: `Entries`, `Facilities`, `Settings`, `Users`, `Tokens`.

## Step 4 — Publish the connection

1. Click **Deploy → New deployment**.
2. Click the ⚙️ gear → **Web app**.
3. Description: anything. Set:
   - **Execute as: Me**
   - **Who has access: Anyone**  ← (this only lets people *talk to* the sheet through the code — they still can't open the spreadsheet, and the website asks for email + password before showing anything)
4. Click **Deploy** and **copy the Web app URL** — it ends in `/exec`.

## Step 5 — Send the URL back

Paste that `/exec` URL back into the chat. I'll plug it into the website, push the update,
and the site becomes a proper sign-in dashboard with everything stored in your sheet.

---

## What you'll see in the spreadsheet afterwards

| Tab | Contents |
|---|---|
| `Entries` | Every log entry — date, business, box kg, waste kg, amount… (read it like a spreadsheet!) |
| `Facilities` | The business list |
| `Settings` | Rate, currency, company name |
| `Users` | Email + name + role. Passwords are **hashed** (unreadable, even to you) |
| `Tokens` | Sign-in sessions, auto-expire after 30 days |

## How staff get access

Sign in as administrator → **Settings & Backup → Staff & Access** → add their name, email and a password.
Remove them any time — it takes effect immediately.

## Honest limits (why it's free)

- Fine for thousands of entries and a handful of users.
- The login is a solid everyday lock, **not bank-grade security** — nobody can see data without an account, but don't reuse an important password there.
- Google's free quota allows ~20,000 actions per day — a log book uses a few dozen.

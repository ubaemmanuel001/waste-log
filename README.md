# 📒 The Waste Log Book

A simple site for logging waste KG per business — built to replace the paper log book.
No installation, no internet needed for the basic version, no monthly fees. **Just double-click `index.html`.**

It runs in two modes:

- **Local mode** (as shipped): records live in the browser on that computer.
- **Cloud mode** (once the Google Sheet backend is connected): records live in a private
  Google Sheet, everyone signs in with an email + password, and all devices see the same data.
  Setup guide: **SHEETS-SETUP.md** (takes about 5 minutes).

---

## 🚀 How to run it

1. Open this folder.
2. **Double-click `index.html`** — it opens in your browser (Chrome, Edge, or Safari).
3. That's it. Everything you type is saved automatically in the browser.

> 💡 **Optional — put it on the desktop as an icon:** in Chrome or Edge, click the menu (⋮) →
> *Save and share* → *Create shortcut* (tick "Open as window").

> 🌐 **To use it on several computers at once**, open Terminal in this folder and run
> `python3 -m http.server 8000`, then everyone opens `http://<computer-ip>:8000`.
> Each device keeps its own copy of the records — use the CSV/backup files to move data between them.

---

## 📒 The four tabs (in order, like a folder of dividers)

| Tab | What it does |
|---|---|
| **1 · New Entry** | The daily screen, used most. Pick the date, type a business name (it finds existing ones as you type — or offers to add a new one), type Box KG and Waste KG. The **Total and Amount work themselves out**. Then press Save. |
| **2 · All Records** | Every entry ever saved. A **search box**, a "Show" box for date ranges (this month, this week, chosen dates…), and clickable column headings to sort — including **A→Z by business**. The totals line at the bottom always matches what's on screen. |
| **3 · Month Report** | Pick a month → the month-end report appears by itself: total kg per business (A–Z) or per day, grand totals, and the money total. One click to print or download as CSV. |
| **4 · Businesses** | Every business on the list, arranged **alphabetically** under A–Z letter dividers. Add, rename or delete. Shows each one's lifetime kg, money and last pickup. |

**Settings & Backup** (top right) is the only other place — company name for printouts, the default rate, backups, and example entries.

## ✨ Little things that help

- Date always starts on **today**; the rate and "Received by" name are **remembered** from the last entry.
- A brand-new business name offers **"Add …"** right in the dropdown — no separate setup.
- The **Amount fills itself in** (Total × Rate) but can be typed over for special prices.
- After saving, a big green **"✓ Saved"** note confirms exactly what was recorded.
- **Print** gives a tidy version of the paper log book with the company name at the top.
- Works **offline** — it's just a file on the computer.

## 📲 Sending to WhatsApp

Two options, both free:

- **"Send to WhatsApp"** (in All Records and Month Report) — puts the CSV file in the phone's
  share menu. Tap **WhatsApp**, then the chat — your own number ("Message yourself"), a boss,
  a client, or a group. Works on Android and iPhone. On desktop computers it simply downloads
  the CSV instead.
- **"Send the summary to a phone number"** (bottom of Month Report) — type any WhatsApp number
  and it opens their chat with the month's totals as a ready-written message.
  *(True no-tap file delivery to a number needs the paid WhatsApp Business API, so the file
  itself always goes through the share menu.)*

## 📤 Taking data out

- **All Records → Download CSV** — exactly the rows on screen (opens in Excel).
- **Month Report → Download Report CSV / Download Entries CSV**.
- **Settings & Backup → Download Backup File** — a full copy of everything. **Do this weekly.**
  Restore it any time with *Restore From Backup File* (for example, on a new computer).

## ⚠️ The one rule (local mode)

Records live in the **browser on that computer** (that's why no internet is needed). So:

- Always use the **same browser** on the same computer.
- **Clearing the browser's history/site data erases it** — keep regular backups!
- If the computer is lost, a backup file brings everything back in one click.

*(In cloud mode these worries disappear: the Google Sheet holds everything, sign-in works on any device.)*

---

*Example entries can be loaded from "Settings & Backup" to try everything out, then removed with "Delete All Data".*

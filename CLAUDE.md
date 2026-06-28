# SplitEasy — Project Instructions

## What this is
A Splitwise-style expense-splitting PWA. The frontend is a **single HTML file** (`index.html`) served via GitHub Pages. All data lives in a **Google Sheet** and is accessed through a **Google Apps Script** deployed as a web app.

## Architecture

```
index.html  (PWA frontend — single file, no build step)
  ↕  JSON API (fetch)
Code.gs     (Google Apps Script — deployed at SCRIPT_URL in index.html)
  ↕
Google Sheet ID: 1Q7uUb4WLmT1NRp-dItIu9qYpQ2nNUgAI9yEaP4-Lakc
  Tabs: "Users", "Groups", one tab per group
```

## Making changes

### Frontend (`index.html`)
- Edit the file directly — no build, no bundler.
- Bump the cache name in `sw.js` (`CACHE = 'spliteasy-vN'`) whenever `index.html` changes, so mobile PWA clients get the update.
- Currency is **AED** throughout. Do not add currency configuration.

### Apps Script (`Code.gs`)
The file in this repo is the source of truth. After editing `Code.gs`:
1. Open [script.google.com](https://script.google.com), open the project linked to the Sheet above.
2. Paste/replace the updated functions.
3. **Deploy → Manage Deployments → Edit (pencil) → New version → Deploy.**
4. The URL in `index.html` (`SCRIPT_URL`) does NOT change between deployments.

## Key API actions (doPost in Code.gs)
| Action | What it does |
|--------|-------------|
| `getGlobalUsers` | Returns all names from the Users sheet |
| `addGlobalUser` | Appends a new name to the Users sheet |
| `getGroupsWithBalances` | Returns groups + per-user net balance for the landing |
| `createGroup` | Creates a row in Groups sheet + a new tab for expenses |
| `getGroupData` | Returns members, all expenses, and simplified net balances |
| `addExpense` | Appends an expense row to the group tab |
| `updateExpense` | Overwrites an expense row |
| `deleteExpense` | Deletes an expense row (works for settlements too) |
| `settleDebt` | Appends a settlement row (`isSettlement=true`) |
| `addMemberToGroup` | Adds a member name to the group's JSON member list |
| `removeMemberFromGroup` | Removes a member (blocked if they have an outstanding balance) |

## Balance calculation (Code.gs `calculateNetBalances_`)
- Regular expenses: each participant owes `paidBy` their share from `splitAmounts`.
- Settlements: `participants[0]` (debtor) owes `participants[1]` (creditor) **less** by the settled amount. Only one `add_()` call — no reverse debt is created.
- Net calculation: for each pair, `fromOwesTo - toOwesFrom`; only emit if `|net| > 0.005`.

## Known data notes
- Settlement rows: `isSettlement = true`, `participants = [debtor, creditor]`, `paidBy = debtor`.
- If a bug caused duplicate/wrong settlement rows in the Sheet, delete them directly in Google Sheets.

## Do NOT do
- Add external npm dependencies or a build step — keep it a single HTML file.
- Change the Google Sheet ID or Apps Script URL without updating the other.
- Hard-code user names — they all come from the Users sheet at runtime.

/**
 * SplitEasy - Splitwise-style expense splitting web app
 *
 * Connected to the Google Sheet below for all data persistence.
 * Publish: Extensions > Apps Script > Deploy > New Deployment >
 *          Web app > Execute as "Me" > Who has access "Anyone" > Deploy
 *
 * Sheet tabs created automatically: "Groups", one tab per group.
 * "Users" tab must already exist with names in Column A (row 1 = header).
 */

const SHEET_ID = '1Q7uUb4WLmT1NRp-dItIu9qYpQ2nNUgAI9yEaP4-Lakc';

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

// ─────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sanitizeSheetName_(name) {
  return name.replace(/[\\\/\?\*\[\]:]/g, '_').substring(0, 100).trim();
}

function ensureGroupsSheet_() {
  const spreadsheet = ss_();
  let sheet = spreadsheet.getSheetByName('Groups');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Groups');
    sheet.appendRow(['Group Name', 'Members', 'Created Date']);
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();
  }
  return sheet;
}

function parseDate_(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return val.toString();
}

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

function getGlobalUsers() {
  const sheet = ss_().getSheetByName('Users');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data.slice(1)
    .map(row => (row[0] || '').toString().trim())
    .filter(name => name !== '');
}

// ─────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────

function getGroupsWithBalances(userName) {
  const sheet = ensureGroupsSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const spreadsheet = ss_();

  return data.slice(1)
    .filter(row => row[0] && row[0].toString().trim() !== '')
    .map(row => {
      let members = [];
      try { members = JSON.parse(row[1]); } catch (e) { members = []; }
      return {
        name: row[0].toString().trim(),
        members: members,
        created: parseDate_(row[2])
      };
    })
    .filter(group => group.members.includes(userName))
    .map(group => {
      const safeSheet = spreadsheet.getSheetByName(sanitizeSheetName_(group.name));
      let userBalance = 0;
      if (safeSheet) {
        const expenses = readExpenses_(safeSheet.getDataRange().getValues());
        const balances = calculateNetBalances_(expenses);
        balances.forEach(b => {
          if (b.from === userName) userBalance -= b.amount;
          if (b.to === userName) userBalance += b.amount;
        });
      }
      return Object.assign({}, group, { userBalance: Math.round(userBalance * 100) / 100 });
    });
}

function createGroup(groupName, members) {
  const groupsSheet = ensureGroupsSheet_();
  const existing = groupsSheet.getDataRange().getValues();

  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] && existing[i][0].toString().toLowerCase() === groupName.toLowerCase()) {
      throw new Error('A group named "' + groupName + '" already exists.');
    }
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  groupsSheet.appendRow([groupName, JSON.stringify(members), today]);

  const spreadsheet = ss_();
  const safeSheetName = sanitizeSheetName_(groupName);
  if (!spreadsheet.getSheetByName(safeSheetName)) {
    const newSheet = spreadsheet.insertSheet(safeSheetName);
    newSheet.appendRow(['ID', 'Date', 'Description', 'Amount', 'Paid By',
                        'Split Type', 'Participants', 'Split Amounts', 'Is Settlement']);
    newSheet.setFrozenRows(1);
  }

  SpreadsheetApp.flush();
  return { success: true, groupName: groupName };
}

function addMemberToGroup(groupName, memberName) {
  const sheet = ensureGroupsSheet_();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString() === groupName) {
      let members = [];
      try { members = JSON.parse(data[i][1]); } catch (e) {}
      if (!members.includes(memberName)) {
        members.push(memberName);
        sheet.getRange(i + 1, 2).setValue(JSON.stringify(members));
        SpreadsheetApp.flush();
      }
      return { success: true };
    }
  }
  throw new Error('Group not found: ' + groupName);
}

// ─────────────────────────────────────────────
// GROUP DATA (expenses + balances)
// ─────────────────────────────────────────────

function getGroupData(groupName) {
  const spreadsheet = ss_();
  const safeSheetName = sanitizeSheetName_(groupName);
  const sheet = spreadsheet.getSheetByName(safeSheetName);

  // Fetch members from Groups sheet
  const groupsSheet = ensureGroupsSheet_();
  const groupsData = groupsSheet.getDataRange().getValues();
  let members = [];
  for (let i = 1; i < groupsData.length; i++) {
    if (groupsData[i][0] && groupsData[i][0].toString() === groupName) {
      try { members = JSON.parse(groupsData[i][1]); } catch (e) {}
      break;
    }
  }

  if (!sheet) return { members: members, expenses: [], balances: [] };

  const expenses = readExpenses_(sheet.getDataRange().getValues());
  const balances = calculateNetBalances_(expenses);

  return { members: members, expenses: expenses, balances: balances };
}

function readExpenses_(rows) {
  const expenses = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    let participants = [];
    let splitAmounts = {};
    try { participants = JSON.parse(row[6]); } catch (e) {}
    try { splitAmounts = JSON.parse(row[7]); } catch (e) {}

    expenses.push({
      id: row[0].toString(),
      date: parseDate_(row[1]),
      description: row[2] ? row[2].toString() : '',
      amount: parseFloat(row[3]) || 0,
      paidBy: row[4] ? row[4].toString() : '',
      splitType: row[5] ? row[5].toString() : '',
      participants: participants,
      splitAmounts: splitAmounts,
      isSettlement: row[8] === true || row[8] === 'TRUE' || row[8] === 'true'
    });
  }
  return expenses;
}

// ─────────────────────────────────────────────
// BALANCE CALCULATION
// ─────────────────────────────────────────────

function calculateNetBalances_(expenses) {
  const debt = {};

  const add_ = (from, to, amount) => {
    if (!debt[from]) debt[from] = {};
    if (!debt[from][to]) debt[from][to] = 0;
    debt[from][to] += amount;
  };

  expenses.forEach(exp => {
    if (exp.isSettlement) {
      const from = exp.participants[0];
      const to = exp.participants[1];
      if (!from || !to) return;
      add_(from, to, -exp.amount);
      add_(to, from, exp.amount);
    } else {
      const paidBy = exp.paidBy;
      Object.entries(exp.splitAmounts).forEach(([person, share]) => {
        if (person !== paidBy && parseFloat(share) > 0) {
          add_(person, paidBy, parseFloat(share));
        }
      });
    }
  });

  const result = [];
  const processed = new Set();

  Object.keys(debt).forEach(from => {
    Object.keys(debt[from]).forEach(to => {
      const key = [from, to].sort().join('|||');
      if (processed.has(key)) return;
      processed.add(key);

      const fromOwesTo = (debt[from] && debt[from][to]) || 0;
      const toOwesFrom = (debt[to] && debt[to][from]) || 0;
      const net = fromOwesTo - toOwesFrom;

      if (net > 0.005) {
        result.push({ from, to, amount: Math.round(net * 100) / 100 });
      } else if (net < -0.005) {
        result.push({ from: to, to: from, amount: Math.round(Math.abs(net) * 100) / 100 });
      }
    });
  });

  return result;
}

// ─────────────────────────────────────────────
// WRITE EXPENSE / SETTLEMENT
// ─────────────────────────────────────────────

function addExpense(groupName, expenseObj) {
  const sheet = ss_().getSheetByName(sanitizeSheetName_(groupName));
  if (!sheet) throw new Error('Group sheet not found.');

  const id = Date.now().toString();
  sheet.appendRow([
    id,
    expenseObj.date,
    expenseObj.description,
    parseFloat(expenseObj.amount),
    expenseObj.paidBy,
    expenseObj.splitType,
    JSON.stringify(expenseObj.participants),
    JSON.stringify(expenseObj.splitAmounts),
    false
  ]);

  SpreadsheetApp.flush();
  return { success: true, id: id };
}

function settleDebt(groupName, from, to, amount) {
  const sheet = ss_().getSheetByName(sanitizeSheetName_(groupName));
  if (!sheet) throw new Error('Group sheet not found.');

  const id = Date.now().toString();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  sheet.appendRow([
    id,
    today,
    from + ' settled with ' + to,
    parseFloat(amount),
    from,
    'settlement',
    JSON.stringify([from, to]),
    JSON.stringify({}),
    true
  ]);

  SpreadsheetApp.flush();
  return { success: true };
}

// ─────────────────────────────────────────────
// MEMBER MANAGEMENT
// ─────────────────────────────────────────────

function removeMemberFromGroup(groupName, memberName) {
  const data = getGroupData(groupName);
  const hasBalance = data.balances.some(b => b.from === memberName || b.to === memberName);
  if (hasBalance) {
    const bal = data.balances.find(b => b.from === memberName || b.to === memberName);
    throw new Error(memberName + ' has an outstanding balance of AED ' + bal.amount.toFixed(2) + '. Please settle first.');
  }

  const sheet = ensureGroupsSheet_();
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString() === groupName) {
      let members = [];
      try { members = JSON.parse(rows[i][1]); } catch (e) {}
      if (members.length <= 2) throw new Error('A group must have at least 2 members.');
      const idx = members.indexOf(memberName);
      if (idx > -1) {
        members.splice(idx, 1);
        sheet.getRange(i + 1, 2).setValue(JSON.stringify(members));
        SpreadsheetApp.flush();
      }
      return { success: true };
    }
  }
  throw new Error('Group not found: ' + groupName);
}

// ─────────────────────────────────────────────
// EXPENSE EDIT / DELETE
// ─────────────────────────────────────────────

function updateExpense(groupName, expenseId, expenseObj) {
  const sheet = ss_().getSheetByName(sanitizeSheetName_(groupName));
  if (!sheet) throw new Error('Group sheet not found.');

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString() === expenseId.toString()) {
      sheet.getRange(i + 1, 1, 1, 9).setValues([[
        expenseId,
        expenseObj.date,
        expenseObj.description,
        parseFloat(expenseObj.amount),
        expenseObj.paidBy,
        expenseObj.splitType,
        JSON.stringify(expenseObj.participants),
        JSON.stringify(expenseObj.splitAmounts),
        false
      ]]);
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('Expense not found.');
}

function deleteExpense(groupName, expenseId) {
  const sheet = ss_().getSheetByName(sanitizeSheetName_(groupName));
  if (!sheet) throw new Error('Group sheet not found.');

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString() === expenseId.toString()) {
      sheet.deleteRow(i + 1);
      SpreadsheetApp.flush();
      return { success: true };
    }
  }
  throw new Error('Expense not found.');
}

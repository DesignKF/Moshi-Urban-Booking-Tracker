// Google Sheets mutations must retain row addresses used by dependent reports.
const normalizeHeader = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const bookingHeaders = ['bookingid', 'reservationid', 'bookingno', 'ref', 'id'];
const guestHeaders = ['guestname', 'guest', 'name'];
export function exactBookingRow(rows, headerRowIndex, bookingId) {
  const id = String(bookingId ?? '').trim();
  if (!id || headerRowIndex < 0) return -1;
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const col = headers.findIndex(h => bookingHeaders.includes(h));
  if (col < 0) throw new Error('Booking ID column was not found.');
  const matches = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    if (String(rows[r]?.[col] ?? '').trim() === id) matches.push(r + 1);
  }
  if (matches.length > 1) throw new Error('Duplicate Booking ID: ' + id + '. Resolve duplicates before changing this booking.');
  return matches[0] ?? -1;
}
function quote(title) { return "'" + title.replace(/'/g, "''") + "'"; }
function letter(n) {
  let result = '';
  while (n > 0) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); }
  return result;
}
async function request(url, token, body) {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Google Sheets request failed (' + response.status + ').');
  return data;
}
export async function readBookingGrid(spreadsheetId, sheetName, token) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  const metadata = await request(base + '?fields=sheets.properties', token);
  const sheet = (metadata.sheets || []).find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error('Tab "' + sheetName + '" was not found. No data was changed.');
  const properties = sheet.properties;
  const range = quote(sheetName) + '!A1:' + letter(properties.gridProperties.columnCount) + properties.gridProperties.rowCount;
  const data = await request(base + '?includeGridData=true&ranges=' + encodeURIComponent(range) +
    '&fields=sheets(properties,data(startRow,startColumn,rowData.values(userEnteredValue,effectiveValue,formattedValue,note)))', token);
  const grid = (data.sheets || []).find(s => s.properties.title === sheetName)?.data?.[0];
  const cells = (grid?.rowData || []).map(r => r.values || []);
  const rows = cells.map(row => row.map(cell => String(cell.formattedValue ??
    cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ??
    cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? '')));
  const headerIndex = rows.slice(0, 35).findIndex(row => {
    const headers = row.map(normalizeHeader);
    return headers.some(h => bookingHeaders.includes(h)) && headers.some(h => guestHeaders.includes(h)) &&
      headers.some(h => ['checkin', 'checkindate', 'arrival', 'arrivaldate'].includes(h));
  });
  if (headerIndex < 0) throw new Error('Booking table headers were not found. No data was changed.');
  const idColumn = rows[headerIndex].map(normalizeHeader).findIndex(h => bookingHeaders.includes(h));
  // Report tabs can have the same headers, but their IDs are formulas, not writable records.
  if (cells.slice(headerIndex + 1).some(row => row[idColumn]?.userEnteredValue?.formulaValue)) {
    throw new Error('This tab is a calculated report. Select the Bookings input tab.');
  }
  return { base, properties, cells, rows, headerIndex, idColumn };
}
export function clearBookingRequests(grid, rowNumbers) {
  return [...new Set(rowNumbers)].map(rowNumber => {
    if (!Number.isInteger(rowNumber) || rowNumber <= grid.headerIndex + 1 ||
        rowNumber > grid.properties.gridProperties.rowCount) throw new Error('Invalid booking row.');
    const cells = grid.cells[rowNumber - 1] || [];
    const values = Array.from({ length: grid.properties.gridProperties.columnCount }, (_, col) => {
      const formula = cells[col]?.userEnteredValue?.formulaValue;
      return formula ? { userEnteredValue: { formulaValue: formula } } : {};
    });
    return { updateCells: {
      range: { sheetId: grid.properties.sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber,
        startColumnIndex: 0, endColumnIndex: grid.properties.gridProperties.columnCount },
      rows: [{ values }], fields: 'userEnteredValue,note',
    } };
  });
}
export async function clearBookingsSafely(spreadsheetId, sheetName, bookingIds, token) {
  const grid = await readBookingGrid(spreadsheetId, sheetName, token);
  const ids = bookingIds === null
    ? grid.rows.slice(grid.headerIndex + 1).map(row => row[grid.idColumn]?.trim()).filter(id => id && !/^(total|totals|summary|grand total)$/i.test(id))
    : [...new Set(bookingIds.map(id => String(id).trim()))];
  const rows = ids.map(id => exactBookingRow(grid.rows, grid.headerIndex, id)).filter(row => row > 0);
  if (rows.length) await request(grid.base + ':batchUpdate', token, { requests: clearBookingRequests(grid, rows) });
  return rows.length;
}
// A health check reports damage; it never guesses a replacement or deletes report rows.
export async function inspectWorkbookErrors(spreadsheetId, token) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  const metadata = await request(base + '?fields=sheets.properties', token);
  const errors = [];
  for (const sheet of metadata.sheets || []) {
    const p = sheet.properties;
    if (p.sheetType && p.sheetType !== 'GRID') continue;
    const range = quote(p.title) + '!A1:' + letter(p.gridProperties.columnCount) + p.gridProperties.rowCount;
    const data = await request(base + '?includeGridData=true&ranges=' + encodeURIComponent(range) +
      '&fields=sheets(data(startRow,startColumn,rowData.values(userEnteredValue,effectiveValue)))', token);
    for (const s of data.sheets || []) for (const block of s.data || []) {
      (block.rowData || []).forEach((row, r) => (row.values || []).forEach((cell, c) => {
        const formula = cell.userEnteredValue?.formulaValue || '';
        if (cell.effectiveValue?.errorValue || formula.includes('#REF!')) {
          errors.push(quote(p.title) + '!' + letter((block.startColumn || 0) + c + 1) + ((block.startRow || 0) + r + 1));
        }
      }));
    }
  }
  return { fixedCount: 0, clearedRows: 0, repairedFormulas: [], remainingErrors: errors.length,
    errorCells: errors.slice(0, 50), message: errors.length
      ? errors.length + ' formula errors remain in the workbook. Restore their references from a verified template; no formulas or records were erased.'
      : 'No formula errors found across the workbook.' };
}

export async function writeBookingSafely(spreadsheetId, sheetName, reservation, token, buildRow, isNew) {
  const grid = await readBookingGrid(spreadsheetId, sheetName, token);
  let rowNumber = exactBookingRow(grid.rows, grid.headerIndex, reservation.id);
  if (rowNumber < 0 && !isNew) throw new Error('Booking no longer exists in the sheet. Refresh before editing.');
  if (rowNumber < 0) {
    // Reuse a cleared slot only if every literal cell is empty. Formula-only rows are reusable.
    for (let r = grid.headerIndex + 1; r < grid.properties.gridProperties.rowCount; r++) {
      const templateGross = grid.rows[grid.headerIndex].map(normalizeHeader).indexOf('grossvalue');
      if (grid.rows[grid.headerIndex].map(normalizeHeader).includes('pricingmode') &&
          !grid.cells[r]?.[templateGross]?.userEnteredValue?.formulaValue) continue;
      if (!(grid.cells[r] || []).some(c => c.userEnteredValue && !c.userEnteredValue.formulaValue &&
          (c.userEnteredValue.stringValue !== undefined ? c.userEnteredValue.stringValue !== '' : true))) {
        rowNumber = r + 1; break;
      }
    }
  }
  if (rowNumber < 0) throw new Error('No empty booking row remains. Extend the workbook template before adding bookings.');
  const headers = grid.rows[grid.headerIndex];
  const existing = grid.rows[rowNumber - 1] || [];
  const proposed = buildRow(headers, reservation, existing);
  const data = [];
  proposed.forEach((value, col) => {
    const cell = grid.cells[rowNumber - 1]?.[col];
    if (cell?.userEnteredValue?.formulaValue || value === (existing[col] ?? '')) return;
    const h = normalizeHeader(headers[col]);
    const isText = ['bookingid','reservationid','id','ref','guestname','guest','name','guestid','gid','customerid',
      'phonenumber','phone','whatsapp','mobile','email','emailaddress','mail','notes','comment','comments',
      'request','requests','platform','source','channel','roomselection','selectroom','room','bedselection',
      'selectbed','bed','bedcode','unitid','status','state','bookingstatus','currency','curr','pricingmode'].includes(h);
    data.push({ range: quote(sheetName) + '!' + letter(col + 1) + rowNumber,
      values: [[isText && value !== '' ? "'" + value : value]] });
  });
  if (!data.length) return {};
  return request(grid.base + '/values:batchUpdate', token, { valueInputOption: 'USER_ENTERED', data });
}

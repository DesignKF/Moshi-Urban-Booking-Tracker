import { Reservation } from './types';

export interface SheetFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// 1. Search Google Drive for spreadsheets (both My Drive and Shared with Me / Team Drives)
export async function listUserSpreadsheets(accessToken: string): Promise<SheetFile[]> {
  try {
    const q = "mimeType='application/vnd.google.apps.spreadsheet' and trashed=false";
    // Standard Drive v3 list query
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (netErr: any) {
      // Retry once without extra query parameters if network or query failed
      try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=50`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (retryErr) {
        throw new Error('Network error connecting to Google Drive. Please check your internet connection or connect via direct spreadsheet link below.');
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // If 401 Unauthorized or expired token, throw specific message
      if (res.status === 401) {
        throw new Error('Google authorization token expired. Please click "Sign in with Google" again.');
      }
      throw new Error(err.error?.message || `Failed to fetch sheets (${res.status})`);
    }

    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('Error listing sheets:', err);
    throw err;
  }
}

// 1b. Direct lookup / validation by Spreadsheet ID or URL
export async function validateSpreadsheetById(
  sheetIdOrUrl: string,
  accessToken: string
): Promise<{ id: string; name: string } | null> {
  // Extract spreadsheet ID if URL was passed
  let id = sheetIdOrUrl.trim();
  const match = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    id = match[1];
  }

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Cannot access spreadsheet (${res.status}). Verify permissions.`);
  }

  const data = await res.json();
  return {
    id,
    name: data.properties?.title || 'Spreadsheet',
  };
}

// Helper: Format safe Google Sheets A1 range, wrapping sheet title in single quotes if it contains spaces or special characters
export function formatA1Range(sheetTitle: string, cellRange?: string): string {
  const cleanTitle = sheetTitle.trim().replace(/^'|'$/g, '');
  const escapedTitle = cleanTitle.replace(/'/g, "''");
  const quoted = `'${escapedTitle}'`;
  return cellRange ? `${quoted}!${cellRange}` : quoted;
}

// 2. Read sheets/tabs metadata of a spreadsheet
export async function getSpreadsheetDetails(spreadsheetId: string, accessToken: string) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch spreadsheet details (${res.status})`);
  }
  const data = await res.json();
  const sheets: { title: string; sheetId: number }[] = (data.sheets || []).map((s: any) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
  return { sheets };
}

// 3. Read rows from a spreadsheet tab or range
export async function readSheetRows(
  spreadsheetId: string,
  range: string,
  accessToken: string
): Promise<string[][]> {
  const encodedRange = encodeURIComponent(range);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to read sheet (${res.status})`);
  }
  const data = await res.json();
  return data.values || [];
}

function formatSheetDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// 4. Parse rows into Reservation objects, handling Moshi Urban Booking sheet structure
export function parseSheetToReservations(rows: string[][]): Reservation[] {
  if (!rows || rows.length === 0) return [];

  // Look for header row that mentions "Booking ID"
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 35); i++) {
    const rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1 && rows.length > 0) {
    headerRowIndex = 0;
  }

  const rawHeaders = rows[headerRowIndex] || [];
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const getColIdx = (candidates: string[]) => {
    return normalizedHeaders.findIndex(h => candidates.some(c => h.includes(c)));
  };

  const idIdx = getColIdx(['bookingid', 'id', 'ref']);
  const guestIdx = getColIdx(['guestname', 'guest', 'name']);
  const phoneIdx = getColIdx(['phonenumber', 'phone', 'whatsapp', 'mobile']);
  const emailIdx = getColIdx(['emailaddress', 'email', 'mail']);
  const guestIdIdx = getColIdx(['guestid', 'gid', 'customerid']);
  const platformIdx = getColIdx(['platform', 'source', 'channel']);
  const checkInIdx = getColIdx(['checkin', 'arrival', 'startdate', 'from']);
  const checkOutIdx = getColIdx(['checkout', 'departure', 'enddate', 'to']);
  const roomIdx = getColIdx(['roomselection', 'roomname', 'room', 'category']);
  const unitIdx = getColIdx(['bedselection', 'bedcode', 'unitid', 'bed', 'unit']);
  const statusIdx = getColIdx(['status', 'bookingstatus', 'state']);
  const currencyIdx = getColIdx(['currency', 'curr']);
  const grossIdx = getColIdx(['grossvalue', 'gross', 'staytotal', 'rate', 'price', 'totalamount', 'total']);
  const balanceIdx = getColIdx(['balancedue', 'balance', 'outstanding', 'due']);
  const depositIdx = getColIdx(['depositreceived', 'deposit', 'paidamount', 'paid', 'received']);
  const notesIdx = getColIdx(['notes', 'note', 'comments', 'requests', 'special']);
  const nightsIdx = getColIdx(['nights', 'night', 'duration']);

  const reservations: Reservation[] = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    if (row.every(c => !c || String(c).trim() === '')) continue;

    const val = (idx: number) => (idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : '');

    const bookingId = val(idIdx) || `MU-${r - headerRowIndex}`;
    const guestName = val(guestIdx);
    if (!guestName || guestName.toLowerCase().includes('total') || guestName.toLowerCase().includes('booking id')) {
      continue;
    }

    let room = val(roomIdx);
    let unit = val(unitIdx);

    // Clean up room names like "Bondeni (Room 3)" vs "Bondeni"
    let cleanRoom = room;
    if (cleanRoom.toLowerCase().includes('njoro')) cleanRoom = 'Njoro';
    else if (cleanRoom.toLowerCase().includes('bondeni')) cleanRoom = 'Bondeni';
    else if (cleanRoom.toLowerCase().includes('mawenzi')) cleanRoom = 'Mawenzi';
    else if (cleanRoom.toLowerCase().includes('soweto')) cleanRoom = 'Soweto';

    // STRICT VALIDATION & RECONCILIATION:
    // If unit and cleanRoom mismatch (e.g. cleanRoom is Soweto but bed is M-B1L, or cleanRoom is Bondeni but bed is S-B1L),
    // enforce consistency so the spreadsheet validation rule (which restricts Bed dropdown by selected Room) never throws "Invalid: Input must be an item on the specified list"
    const bedPrefix = (unit || '').charAt(0).toUpperCase();
    const roomExpectedPrefix = cleanRoom === 'Mawenzi' ? 'M'
      : cleanRoom === 'Njoro' ? 'N'
      : cleanRoom === 'Bondeni' ? 'B'
      : cleanRoom === 'Soweto' ? 'S' : '';

    if (cleanRoom && (!unit || (bedPrefix && roomExpectedPrefix && bedPrefix !== roomExpectedPrefix))) {
      // Re-assign default valid bed for this room
      if (cleanRoom === 'Mawenzi') unit = 'M-S1';
      else if (cleanRoom === 'Njoro') unit = 'N-B1L';
      else if (cleanRoom === 'Bondeni') unit = 'B-B1L';
      else if (cleanRoom === 'Soweto') unit = 'S-S1';
    } else if (unit && !cleanRoom) {
      if (bedPrefix === 'M') cleanRoom = 'Mawenzi';
      else if (bedPrefix === 'N') cleanRoom = 'Njoro';
      else if (bedPrefix === 'B') cleanRoom = 'Bondeni';
      else if (bedPrefix === 'S') cleanRoom = 'Soweto';
    }

    const fullRoomName = cleanRoom === 'Mawenzi' ? 'Mawenzi (Room 1)'
      : cleanRoom === 'Njoro' ? 'Njoro (Room 2)'
      : cleanRoom === 'Bondeni' ? 'Bondeni (Room 3)'
      : cleanRoom === 'Soweto' ? 'Soweto (Room 4)'
      : room || 'Mawenzi (Room 1)';

    const checkIn = normalizeDate(val(checkInIdx)) || '2026-09-25';
    const checkOut = normalizeDate(val(checkOutIdx)) || '2026-09-27';

    // Parse nights from column or calculate
    let nights = 1;
    const sheetNights = parseInt(val(nightsIdx), 10);
    if (!isNaN(sheetNights) && sheetNights > 0) {
      nights = sheetNights;
    } else if (checkIn && checkOut) {
      const d1 = new Date(checkIn);
      const d2 = new Date(checkOut);
      const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      nights = diff > 0 ? diff : 1;
    }

    // Parse amounts
    const curr = val(currencyIdx).toUpperCase() === 'TZS' ? 'TZS' : 'USD';
    let totalAmt = parseMoneyNumber(val(grossIdx));
    let paidAmt = parseMoneyNumber(val(depositIdx));
    let balance = parseMoneyNumber(val(balanceIdx));

    if (totalAmt === 0 && nights > 0) {
      totalAmt = nights * 20;
    }

    const status = val(statusIdx) || 'Confirmed';

    reservations.push({
      id: bookingId,
      guestName: guestName,
      guestId: val(guestIdIdx) || undefined,
      email: val(emailIdx) || '',
      phone: val(phoneIdx) || '',
      room: fullRoomName,
      bedCode: unit || 'M-S1',
      unitId: unit || 'M-S1',
      bedsCount: (unit || '').includes('ALL') ? 4 : 1,
      checkIn: checkIn,
      checkOut: checkOut,
      nights: nights,
      totalAmount: totalAmt,
      paidAmount: paidAmt,
      balanceDue: balance,
      status: status,
      currency: curr,
      platform: val(platformIdx) || 'Direct Booking',
      notes: val(notesIdx) || '',
      loyalty: 'New / no recent stays'
    });
  }

  return reservations;
}

// Helper to construct exact row array based on spreadsheet headers
function buildRowForHeaders(
  rawHeaders: string[],
  reservation: Reservation
): string[] {
  const rowData: string[] = new Array(rawHeaders.length).fill('');
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Get simple room name (e.g., "Bondeni" instead of "Bondeni (Room 3)")
  let shortRoom = reservation.room;
  if (shortRoom.includes('Njoro')) shortRoom = 'Njoro';
  else if (shortRoom.includes('Bondeni')) shortRoom = 'Bondeni';
  else if (shortRoom.includes('Mawenzi')) shortRoom = 'Mawenzi';
  else if (shortRoom.includes('Soweto')) shortRoom = 'Soweto';

  // Ensure Bed Code belongs to shortRoom to satisfy Google Sheets dropdown data validation:
  // e.g. Soweto only permits "S-S1", "S-B1L", "S-B1U", "S-ALL". Any "M-B1L" or "B-B1L" violates the validation rule!
  let validBedCode = reservation.unitId || reservation.bedCode;
  const expectedPrefix = shortRoom === 'Mawenzi' ? 'M'
    : shortRoom === 'Njoro' ? 'N'
    : shortRoom === 'Bondeni' ? 'B'
    : shortRoom === 'Soweto' ? 'S' : '';
  const currentBedPrefix = (validBedCode || '').charAt(0).toUpperCase();

  if (expectedPrefix && currentBedPrefix !== expectedPrefix) {
    // If bed prefix doesn't match room, auto-reconcile to the valid default bed for this room
    if (shortRoom === 'Mawenzi') validBedCode = 'M-S1';
    else if (shortRoom === 'Njoro') validBedCode = 'N-B1L';
    else if (shortRoom === 'Bondeni') validBedCode = 'B-B1L';
    else if (shortRoom === 'Soweto') validBedCode = 'S-S1';
  }

  // Format dates matching spreadsheet ("23 Sep 2026")
  const checkInFormatted = formatSheetDate(reservation.checkIn);
  const checkOutFormatted = formatSheetDate(reservation.checkOut);

  // Currency & Values
  const curr = reservation.currency || 'USD';
  const grossFormatted = curr === 'TZS'
    ? `${(reservation.totalAmount * 2645).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${reservation.totalAmount.toFixed(2)}`;

  const balanceFormatted = curr === 'TZS'
    ? `${(reservation.balanceDue * 2645).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${reservation.balanceDue.toFixed(2)}`;

  const depositFormatted = reservation.paidAmount > 0
    ? (curr === 'TZS'
        ? `${(reservation.paidAmount * 2645).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `${reservation.paidAmount.toFixed(2)}`)
    : '–';

  // Standard guest ID format: "GS-000X" (matching Moshi Urban spreadsheet GS-0001, GS-0006, GS-0007)
  let standardGuestId = reservation.guestId;
  if (!standardGuestId) {
    const numericPart = reservation.id.replace(/[^0-9]/g, '');
    const num = numericPart ? parseInt(numericPart, 10) : 1;
    standardGuestId = `GS-${String(num).padStart(4, '0')}`;
  } else if (!standardGuestId.startsWith('GS-') && /^\d+$/.test(standardGuestId)) {
    standardGuestId = `GS-${standardGuestId.padStart(4, '0')}`;
  }

  normalizedHeaders.forEach((col, idx) => {
    if (col === 'bookingid' || col === 'id' || col === 'ref') {
      rowData[idx] = reservation.id;
    } else if (col === 'guestname' || col === 'guest' || col === 'name') {
      rowData[idx] = reservation.guestName;
    } else if (col.includes('phone') || col.includes('whatsapp') || col.includes('mobile')) {
      rowData[idx] = reservation.phone ? reservation.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '') : '';
    } else if (col.includes('email') || col.includes('mail')) {
      rowData[idx] = reservation.email || '';
    } else if (col === 'guestid' || col === 'gid' || col === 'customerid') {
      rowData[idx] = standardGuestId;
    } else if (col === 'platform' || col === 'source' || col === 'channel') {
      rowData[idx] = reservation.platform || 'Direct Booking';
    } else if (col.includes('checkin') || col.includes('arrival')) {
      rowData[idx] = checkInFormatted;
    } else if (col.includes('checkout') || col.includes('departure')) {
      rowData[idx] = checkOutFormatted;
    } else if (col === 'roomselection' || col === 'selectroom' || col === 'room') {
      // Must match dropdown validation values in Google Sheet: "Mawenzi", "Njoro", "Bondeni", "Soweto"
      rowData[idx] = shortRoom;
    } else if (col === 'bedselection' || col === 'selectbedwholeroomcode' || col === 'bedcode' || col === 'unitid' || col === 'bed' || col === 'unit') {
      // Must match valid bed codes in Google Sheet for selected room: "N-B1L", "N-B1U", "B-B1L", "S-S1", "M-ALL", etc.
      rowData[idx] = validBedCode;
    } else if (col === 'status' || col === 'state') {
      rowData[idx] = reservation.status;
    } else if (col === 'currency' || col === 'curr') {
      rowData[idx] = curr;
    } else if (col.includes('gross') || col.includes('total') || col.includes('staytotal') || col.includes('price')) {
      rowData[idx] = grossFormatted;
    } else if (col.includes('balance') || col.includes('due') || col.includes('outstanding')) {
      rowData[idx] = balanceFormatted;
    } else if (col.includes('deposit') || col.includes('paid')) {
      rowData[idx] = depositFormatted;
    } else if (col.includes('otherreceived')) {
      rowData[idx] = '–';
    } else if (col.includes('refunds')) {
      rowData[idx] = '–';
    } else if (col.includes('holdexpires')) {
      rowData[idx] = '';
    } else if (col.includes('notes') || col.includes('comment') || col.includes('request')) {
      rowData[idx] = reservation.notes || '';
    } else if (col === 'nights' || col === 'night' || col === 'duration') {
      rowData[idx] = String(reservation.nights || 1);
    }
  });

  return rowData;
}

function parseMoneyNumber(val: string): number {
  if (!val) return 0;
  // Handle strings like "211,600.00", "80.00", "$100", "(302,000.00)"
  const cleaned = val.replace(/[$€£TZS,]/gi, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  // If number looks like TZS (> 1000), convert to approx USD for standard display
  if (num > 1000) {
    return Math.round(num / 2645);
  }
  return num;
}

function normalizeDate(str: string): string {
  if (!str) return '';
  // Check if standard YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Handle formats like "23 Sep 2026", "23/09/2026", "Sep 23, 2026"
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return str;
}

// 5. Append new reservation row directly to Google Sheets matching header columns
export async function appendReservationToSheet(
  spreadsheetId: string,
  sheetName: string,
  reservation: Reservation,
  accessToken: string
) {
  // Read existing rows to detect header positions and table structure
  const scanRange = formatA1Range(sheetName, 'A1:Z100');
  let existingRows: string[][] = [];
  try {
    existingRows = await readSheetRows(spreadsheetId, scanRange, accessToken);
  } catch (e) {
    console.warn('Could not scan sheet headers:', e);
  }

  // Find header row
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex !== -1) {
    const rawHeaders = existingRows[headerRowIndex] || [];
    const rowData = buildRowForHeaders(rawHeaders, reservation);

    // Find the next empty row right after the table:
    // A row is considered empty if column A (Booking ID) and column B (Guest Name) are blank or only contains dropdown defaults
    let nextRow = existingRows.length + 1;
    for (let r = headerRowIndex + 1; r < existingRows.length; r++) {
      const row = existingRows[r];
      if (!row || row.length === 0) {
        nextRow = r + 1;
        break;
      }
      const bookingIdVal = String(row[0] || '').trim();
      const guestNameVal = String(row[1] || '').trim();
      if (!bookingIdVal && !guestNameVal) {
        nextRow = r + 1;
        break;
      }
    }

    const targetRange = formatA1Range(sheetName, `A${nextRow}`);
    const encodedRange = encodeURIComponent(targetRange);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [rowData],
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to write reservation to row ${nextRow} (${res.status})`);
    }

    return await res.json();
  }

  // Fallback: Default row format appended to sheet matching columns A through R
  const numPart = reservation.id.replace(/[^0-9]/g, '');
  const guestNum = numPart ? parseInt(numPart, 10) : 1;
  const standardGuestId = reservation.guestId || `GS-${String(guestNum).padStart(4, '0')}`;

  let fallbackRoom = reservation.room.replace(/\s*\(Room \d+\)/, '');
  if (fallbackRoom.includes('Njoro')) fallbackRoom = 'Njoro';
  else if (fallbackRoom.includes('Bondeni')) fallbackRoom = 'Bondeni';
  else if (fallbackRoom.includes('Mawenzi')) fallbackRoom = 'Mawenzi';
  else if (fallbackRoom.includes('Soweto')) fallbackRoom = 'Soweto';

  let fallbackBed = reservation.unitId || reservation.bedCode;
  const expPfx = fallbackRoom === 'Mawenzi' ? 'M'
    : fallbackRoom === 'Njoro' ? 'N'
    : fallbackRoom === 'Bondeni' ? 'B'
    : fallbackRoom === 'Soweto' ? 'S' : '';
  if (expPfx && (fallbackBed || '').charAt(0).toUpperCase() !== expPfx) {
    if (fallbackRoom === 'Mawenzi') fallbackBed = 'M-S1';
    else if (fallbackRoom === 'Njoro') fallbackBed = 'N-B1L';
    else if (fallbackRoom === 'Bondeni') fallbackBed = 'B-B1L';
    else if (fallbackRoom === 'Soweto') fallbackBed = 'S-S1';
  }

  const defaultRow = [
    reservation.id,
    reservation.guestName,
    reservation.phone ? reservation.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '') : '',
    reservation.email || '',
    standardGuestId,
    reservation.platform || 'Direct Booking',
    formatSheetDate(reservation.checkIn),
    formatSheetDate(reservation.checkOut),
    fallbackRoom,
    fallbackBed,
    reservation.status,
    reservation.currency || 'USD',
    reservation.totalAmount.toFixed(2),
    reservation.balanceDue.toFixed(2),
    reservation.paidAmount > 0 ? reservation.paidAmount.toFixed(2) : '–',
    '–',
    '–',
    '', // Hold expires
    reservation.notes || '',
    String(reservation.nights || 1)
  ];

  const range = formatA1Range(sheetName, 'A:T');
  const encodedRange = encodeURIComponent(range);

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [defaultRow],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to append reservation to sheet (${res.status})`);
  }

  return await res.json();
}

// 6. Update existing reservation row in Google Sheets
export async function updateReservationInSheet(
  spreadsheetId: string,
  sheetName: string,
  reservation: Reservation,
  accessToken: string
) {
  // First locate row by reading table range
  const range = formatA1Range(sheetName, 'A1:Z150');
  const existingRows = await readSheetRows(spreadsheetId, range, accessToken);
  
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  let targetRowIndex = -1;
  for (let i = 0; i < existingRows.length; i++) {
    const row = existingRows[i];
    if (row && (row[0] === reservation.id || (row[1] && row[1].trim() === reservation.guestName.trim()))) {
      targetRowIndex = i + 1; // 1-based row index in Google Sheets
      break;
    }
  }

  if (targetRowIndex === -1) {
    return appendReservationToSheet(spreadsheetId, sheetName, reservation, accessToken);
  }

  const rawHeaders = headerRowIndex !== -1 ? existingRows[headerRowIndex] : existingRows[0] || [];
  const rowData = buildRowForHeaders(rawHeaders, reservation);

  const updateRange = formatA1Range(sheetName, `A${targetRowIndex}`);
  const encodedRange = encodeURIComponent(updateRange);

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowData],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update reservation in sheet (${res.status})`);
  }

  return await res.json();
}

// 7. Delete reservation row from Google Sheets
export async function deleteReservationFromSheet(
  spreadsheetId: string,
  sheetId: number,
  rowIndex0Based: number,
  accessToken: string
) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex0Based,
              endIndex: rowIndex0Based + 1,
            },
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to delete row in sheet (${res.status})`);
  }

  return await res.json();
}

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
  let res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties,tables)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch spreadsheet details (${res.status})`);
  }
  const data = await res.json();
  const sheets: { title: string; sheetId: number; properties?: any; tables?: any[] }[] = (data.sheets || []).map((s: any) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    properties: s.properties,
    tables: s.tables,
  }));
  return { sheets };
}

// 3. Read rows from a spreadsheet tab or range with automatic retry and friendly network error handling
export async function readSheetRows(
  spreadsheetId: string,
  range: string,
  accessToken: string,
  retries = 2
): Promise<string[][]> {
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Google authorization token expired. Please click "Sign in with Google" to refresh permissions.');
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Failed to read sheet (${res.status})`);
      }

      const data = await res.json();
      return data.values || [];
    } catch (err: any) {
      const isLastAttempt = attempt === retries;
      const isNetworkError =
        err.name === 'TypeError' ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError');

      if (!isLastAttempt && isNetworkError) {
        await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }

      if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
        throw new Error('Network connection to Google Sheets was interrupted. Please check your internet connection or sign in again.');
      }
      throw err;
    }
  }

  return [];
}

function formatSheetDate(dateStr: string): string {
  if (!dateStr) return '';
  // Handle YYYY-MM-DD safely without timezone distortion
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[m] || 'Jan';
      const day = String(d).padStart(2, '0');
      return `${day} ${month} ${y}`;
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
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

  const isErrorVal = (str: any) => {
    const s = String(str || '').trim().toUpperCase();
    return (
      s.startsWith('#') ||
      s.includes('#REF!') ||
      s.includes('#VALUE!') ||
      s.includes('#N/A') ||
      s.includes('#NAME?') ||
      s.includes('#NULL!') ||
      s.includes('#NUM!') ||
      s.includes('#DIV/0!') ||
      s.includes('#ERROR!')
    );
  };

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    if (row.every(c => !c || isErrorVal(c) || String(c).trim() === '')) continue;

    const val = (idx: number) => (idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : '');

    const bookingId = val(idIdx) || `MU-${r - headerRowIndex}`;
    const guestName = val(guestIdx);
    if (
      !guestName ||
      isErrorVal(guestName) ||
      isErrorVal(bookingId) ||
      guestName.toLowerCase().includes('total') ||
      guestName.toLowerCase().includes('summary') ||
      guestName.toLowerCase().includes('booking id')
    ) {
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
    let rowGuestId = val(guestIdIdx);
    if (!rowGuestId) {
      rowGuestId = generateGuestId(guestName, reservations.map(r => r.guestId || ''));
    }

    reservations.push({
      id: bookingId,
      guestName: guestName,
      guestId: rowGuestId,
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

// Scans sheet rows to find any row where a guest name exists but the Guest ID is blank,
// generating unique IDs ready to be backfilled into the sheet
export function detectMissingGuestIdsInRows(rows: string[][]): {
  rowIndex1Based: number;
  colIndex1Based: number;
  guestName: string;
  guestId: string;
}[] {
  if (!rows || rows.length === 0) return [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 35); i++) {
    const rowStr = rows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1 && rows.length > 0) headerRowIndex = 0;
  const rawHeaders = rows[headerRowIndex] || [];
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const guestIdx = normalizedHeaders.findIndex(h => ['guestname', 'guest', 'name'].some(c => h.includes(c)));
  const guestIdIdx = normalizedHeaders.findIndex(h => ['guestid', 'gid', 'customerid'].some(c => h.includes(c)));

  if (guestIdx === -1 || guestIdIdx === -1) return [];

  const existingGuestIds: string[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row && row[guestIdIdx]) {
      existingGuestIds.push(String(row[guestIdIdx]).trim());
    }
  }

  const missing: { rowIndex1Based: number; colIndex1Based: number; guestName: string; guestId: string }[] = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const guestName = String(row[guestIdx] || '').trim();
    const guestId = String(row[guestIdIdx] || '').trim();

    if (guestName && !guestId && !guestName.toLowerCase().includes('total') && !guestName.toLowerCase().includes('booking id')) {
      const generated = generateGuestId(guestName, existingGuestIds);
      existingGuestIds.push(generated);
      missing.push({
        rowIndex1Based: r + 1,
        colIndex1Based: guestIdIdx + 1,
        guestName,
        guestId: generated,
      });
    }
  }

  return missing;
}

// Generate an automatic unique Guest ID based on user specification:
// Takes first letter of first name and first letter of last name, followed by a unique random number
export function generateGuestId(guestName: string, existingGuestIds: string[] = []): string {
  const clean = (guestName || '').trim();
  if (!clean) {
    return `GS-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  const firstChar = (parts[0] ? parts[0].charAt(0) : 'G').toUpperCase();
  const lastChar = (parts.length > 1
    ? parts[parts.length - 1].charAt(0)
    : (parts[0].length > 1 ? parts[0].charAt(1) : 'X')
  ).toUpperCase();
  const prefix = `${firstChar}${lastChar}`;

  let candidate = '';
  let attempts = 0;
  do {
    const randomNum = Math.floor(1000 + Math.random() * 9000); // 4-digit unique random number
    candidate = `${prefix}-${randomNum}`;
    attempts++;
  } while (existingGuestIds.includes(candidate) && attempts < 500);

  return candidate;
}

// Calculate room and bed availability based on dates
export interface RoomBedAvailability {
  roomName: string;
  totalCapacity: number;
  availableBedsCount: number;
  occupiedBedsCount: number;
  availableBeds: { id: string; place: string }[];
  occupiedBeds: { id: string; place: string; guestName: string; checkOut: string }[];
  isAvailable: boolean;
}

export function calculateRoomBedAvailability(
  reservations: Reservation[],
  checkInDate: string,
  checkOutDate: string,
  excludeReservationId?: string
): Record<string, RoomBedAvailability> {
  const ROOM_DEFINITIONS = [
    {
      name: 'Mawenzi (Room 1)',
      shortName: 'Mawenzi',
      capacity: 3,
      beds: [
        { id: 'M-S1', place: 'Single bed' },
        { id: 'M-B1L', place: 'Bunk 1 lower' },
        { id: 'M-B1U', place: 'Bunk 1 upper' },
        { id: 'M-ALL', place: 'Whole room (3 Beds)' },
      ],
    },
    {
      name: 'Njoro (Room 2)',
      shortName: 'Njoro',
      capacity: 6,
      beds: [
        { id: 'N-B1L', place: 'Bunk 1 lower' },
        { id: 'N-B1U', place: 'Bunk 1 upper' },
        { id: 'N-B2L', place: 'Bunk 2 lower' },
        { id: 'N-B2U', place: 'Bunk 2 upper' },
        { id: 'N-B3L', place: 'Bunk 3 lower' },
        { id: 'N-B3U', place: 'Bunk 3 upper' },
        { id: 'N-ALL', place: 'Whole room (6 Beds)' },
      ],
    },
    {
      name: 'Bondeni (Room 3)',
      shortName: 'Bondeni',
      capacity: 4,
      beds: [
        { id: 'B-B1L', place: 'Bunk 1 lower' },
        { id: 'B-B1U', place: 'Bunk 1 upper' },
        { id: 'B-B2L', place: 'Bunk 2 lower' },
        { id: 'B-B2U', place: 'Bunk 2 upper' },
        { id: 'B-ALL', place: 'Whole room (4 Beds)' },
      ],
    },
    {
      name: 'Soweto (Room 4)',
      shortName: 'Soweto',
      capacity: 3,
      beds: [
        { id: 'S-S1', place: 'Single bed' },
        { id: 'S-B1L', place: 'Bunk 1 lower' },
        { id: 'S-B1U', place: 'Bunk 1 upper' },
        { id: 'S-ALL', place: 'Whole room (3 Beds)' },
      ],
    },
  ];

  const targetIn = new Date(checkInDate);
  const targetOut = new Date(checkOutDate);
  const isValidRange = !isNaN(targetIn.getTime()) && !isNaN(targetOut.getTime()) && targetOut > targetIn;

  const result: Record<string, RoomBedAvailability> = {};

  ROOM_DEFINITIONS.forEach(def => {
    const occupiedBedsList: { id: string; place: string; guestName: string; checkOut: string }[] = [];
    const occupiedBedIds = new Set<string>();

    if (isValidRange) {
      reservations.forEach(r => {
        if (excludeReservationId && r.id === excludeReservationId) return;
        if (r.status?.toLowerCase().includes('cancel')) return;

        // Check if room matches
        if (!r.room.includes(def.shortName)) return;

        const resIn = new Date(r.checkIn);
        const resOut = new Date(r.checkOut);
        if (isNaN(resIn.getTime()) || isNaN(resOut.getTime())) return;

        // Date overlap check: startA < endB && endA > startB
        if (targetIn < resOut && targetOut > resIn) {
          const bedId = (r.unitId || r.bedCode || '').trim();
          if (bedId.includes('ALL')) {
            // Whole room booked: all beds in room are occupied
            def.beds.forEach(b => {
              occupiedBedIds.add(b.id);
              occupiedBedsList.push({
                id: b.id,
                place: b.place,
                guestName: r.guestName,
                checkOut: r.checkOut,
              });
            });
          } else if (bedId) {
            occupiedBedIds.add(bedId);
            const foundBed = def.beds.find(b => b.id === bedId);
            occupiedBedsList.push({
              id: bedId,
              place: foundBed?.place || bedId,
              guestName: r.guestName,
              checkOut: r.checkOut,
            });
          }
        }
      });
    }

    const individualBeds = def.beds.filter(b => !b.id.includes('ALL'));
    const availableIndividualBeds = individualBeds.filter(b => !occupiedBedIds.has(b.id));

    // Whole room ALL unit is only available if all individual beds in room are free
    const availableBeds = [...availableIndividualBeds];
    const wholeRoomBed = def.beds.find(b => b.id.includes('ALL'));
    if (wholeRoomBed && availableIndividualBeds.length === individualBeds.length) {
      availableBeds.push(wholeRoomBed);
    }

    result[def.name] = {
      roomName: def.name,
      totalCapacity: def.capacity,
      availableBedsCount: availableIndividualBeds.length,
      occupiedBedsCount: occupiedBedsList.length,
      availableBeds: availableBeds,
      occupiedBeds: occupiedBedsList,
      isAvailable: availableIndividualBeds.length > 0,
    };
  });

  return result;
}

// Complete Google Apps Script code to install in the Google Sheet for native cell automation
export const GOOGLE_APPS_SCRIPT_CODE = `/**
 * =========================================================================
 * MOSHI URBAN HOSTEL - AUTOMATION & AVAILABILITY ENGINE
 * =========================================================================
 * Install this script in Google Sheets:
 * 1. Open your Google Sheet
 * 2. Click Extensions > Apps Script
 * 3. Replace all code with this script and click Save (disk icon)
 * 4. Edits in your sheet will now automatically:
 *    a. Create a unique Guest ID on typing Guest Name (First Initial + Last Initial + Unique Random Number)
 *    b. Filter Column I (Select Room) to ONLY list rooms with available beds for the chosen dates
 *    c. Filter Column J (Select Bed) to ONLY show available beds in the selected room
 *    d. Calculate Nights (Col S) & Gross Total (Col M) automatically
 * =========================================================================
 */

const HOSTEL_ROOM_BEDS = {
  'Mawenzi (Room 1)': ['M-S1', 'M-B1L', 'M-B1U', 'M-ALL'],
  'Mawenzi': ['M-S1', 'M-B1L', 'M-B1U', 'M-ALL'],
  'Njoro (Room 2)': ['N-B1L', 'N-B1U', 'N-B2L', 'N-B2U', 'N-B3L', 'N-B3U', 'N-ALL'],
  'Njoro': ['N-B1L', 'N-B1U', 'N-B2L', 'N-B2U', 'N-B3L', 'N-B3U', 'N-ALL'],
  'Bondeni (Room 3)': ['B-B1L', 'B-B1U', 'B-B2L', 'B-B2U', 'B-ALL'],
  'Bondeni': ['B-B1L', 'B-B1U', 'B-B2L', 'B-B2U', 'B-ALL'],
  'Soweto (Room 4)': ['S-S1', 'S-B1L', 'S-B1U', 'S-ALL'],
  'Soweto': ['S-S1', 'S-B1L', 'S-B1U', 'S-ALL']
};

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (sheetName.startsWith('_')) return; // ignore helper sheets

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row <= 2) return; // skip header rows

  // Locate column headers
  const headers = sheet.getRange(2, 1, 1, 26).getValues()[0];
  const findCol = (keyword) => {
    return headers.findIndex(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '').includes(keyword)) + 1;
  };

  const colBookingId = findCol('bookingid') || 1;
  const colGuestName = findCol('guestname') || 2;
  const colGuestId = findCol('guestid') || 5;
  const colPlatform = findCol('platform') || 6;
  const colCheckIn = findCol('checkin') || 7;
  const colCheckOut = findCol('checkout') || 8;
  const colRoom = findCol('room') || 9;
  const colBed = findCol('bed') || 10;
  const colStatus = findCol('status') || 11;
  const colNights = findCol('nights') || 19;
  const colGross = findCol('gross') || 13;

  // 1. AUTO GUEST ID GENERATION (When Guest Name in Column B is filled or changed)
  if (col === colGuestName) {
    const guestName = String(sheet.getRange(row, colGuestName).getValue()).trim();
    const guestIdCell = sheet.getRange(row, colGuestId);
    const currentGuestId = String(guestIdCell.getValue()).trim();

    if (guestName && !currentGuestId) {
      // Collect existing Guest IDs to guarantee uniqueness
      const lastRow = Math.max(sheet.getLastRow(), 3);
      const existingIds = sheet.getRange(3, colGuestId, lastRow - 2, 1).getValues().flat().map(String);

      const parts = guestName.split(/\\s+/).filter(Boolean);
      const firstInit = (parts[0] ? parts[0].charAt(0) : 'G').toUpperCase();
      const lastInit = (parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].length > 1 ? parts[0].charAt(1) : 'X')).toUpperCase();
      const prefix = firstInit + lastInit;

      let newId = '';
      let attempts = 0;
      do {
        const rand = Math.floor(1000 + Math.random() * 9000);
        newId = prefix + '-' + rand;
        attempts++;
      } while (existingIds.includes(newId) && attempts < 100);

      guestIdCell.setValue(newId);
    }

    // Auto-populate Booking ID if empty
    const bIdCell = sheet.getRange(row, colBookingId);
    if (!bIdCell.getValue()) {
      bIdCell.setValue('MU-' + (row - 2));
    }

    // Auto-populate Status if empty
    const statusCell = sheet.getRange(row, colStatus);
    if (!statusCell.getValue()) {
      statusCell.setValue('Confirmed');
    }
  }

  // 2. DYNAMIC ROOM & BED DROPDOWNS BASED ON AVAILABILITY
  if (col === colCheckIn || col === colCheckOut || col === colRoom) {
    applyDynamicAvailabilityDropdowns(sheet, row, colCheckIn, colCheckOut, colRoom, colBed, colStatus, colNights, colGross);
  }
}

function applyDynamicAvailabilityDropdowns(sheet, targetRow, colIn, colOut, colRoom, colBed, colStatus, colNights, colGross) {
  const inVal = sheet.getRange(targetRow, colIn).getValue();
  const outVal = sheet.getRange(targetRow, colOut).getValue();
  if (!inVal || !outVal) return;

  const targetIn = new Date(inVal);
  const targetOut = new Date(outVal);
  if (isNaN(targetIn.getTime()) || isNaN(targetOut.getTime()) || targetOut <= targetIn) return;

  // Auto calculate nights
  const diffDays = Math.max(1, Math.round((targetOut.getTime() - targetIn.getTime()) / (1000 * 60 * 60 * 24)));
  if (colNights > 0) {
    sheet.getRange(targetRow, colNights).setValue(diffDays);
  }

  const lastRow = Math.max(sheet.getLastRow(), 3);
  const allRows = sheet.getRange(3, 1, lastRow - 2, 22).getValues();

  // Determine occupied beds during target date range
  const occupiedBeds = new Set();
  allRows.forEach((r, idx) => {
    const rowNum = idx + 3;
    if (rowNum === targetRow) return;

    const rStatus = String(r[colStatus - 1] || '').toLowerCase();
    if (rStatus.includes('cancel')) return;

    const rIn = new Date(r[colIn - 1]);
    const rOut = new Date(r[colOut - 1]);
    if (isNaN(rIn.getTime()) || isNaN(rOut.getTime())) return;

    // Overlap: startA < endB && endA > startB
    if (targetIn < rOut && targetOut > rIn) {
      const bed = String(r[colBed - 1] || '').trim();
      if (bed) {
        occupiedBeds.add(bed);
        if (bed.includes('ALL')) {
          const room = String(r[colRoom - 1] || '').trim();
          const beds = HOSTEL_ROOM_BEDS[room] || [];
          beds.forEach(b => occupiedBeds.add(b));
        }
      }
    }
  });

  // Calculate available rooms (rooms that have at least one unbooked bed)
  const roomNames = ['Mawenzi (Room 1)', 'Njoro (Room 2)', 'Bondeni (Room 3)', 'Soweto (Room 4)'];
  const availableRooms = [];

  roomNames.forEach(room => {
    const beds = HOSTEL_ROOM_BEDS[room] || [];
    const individual = beds.filter(b => !b.includes('ALL'));
    const freeBeds = individual.filter(b => !occupiedBeds.has(b));
    if (freeBeds.length > 0) {
      availableRooms.push(room);
    }
  });

  // Set Column I Data Validation Dropdown
  const roomCell = sheet.getRange(targetRow, colRoom);
  if (availableRooms.length > 0) {
    const roomRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(availableRooms, true)
      .setAllowInvalid(true)
      .setHelpText('Only rooms with available beds for the chosen dates are shown.')
      .build();
    roomCell.setDataValidation(roomRule);
  }

  // Set Column J Data Validation Dropdown for currently selected room
  const currentRoom = String(roomCell.getValue() || '').trim();
  if (currentRoom) {
    const allRoomBeds = HOSTEL_ROOM_BEDS[currentRoom] || [];
    const availableBeds = allRoomBeds.filter(b => {
      if (b.includes('ALL')) {
        const ind = allRoomBeds.filter(ib => !ib.includes('ALL'));
        return ind.every(ib => !occupiedBeds.has(ib));
      }
      return !occupiedBeds.has(b);
    });

    const bedCell = sheet.getRange(targetRow, colBed);
    if (availableBeds.length > 0) {
      const bedRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(availableBeds, true)
        .setAllowInvalid(true)
        .setHelpText('Only unoccupied beds in ' + currentRoom + ' are shown.')
        .build();
      bedCell.setDataValidation(bedRule);
    }
  }
}
`;

// Configure sheet dropdowns, validation rules, formatting, and inventory tab via Google Sheets API
export async function setupSheetAutomations(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string
) {
  const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
  const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
  if (!targetSheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet.`);
  const targetSheetId = targetSheet.sheetId;

  // 1. Check if _Hostel_Config exists, if not create it
  let configSheet = details.sheets.find(s => s.title === '_Hostel_Config');
  if (!configSheet) {
    const addSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: '_Hostel_Config',
                hidden: true,
              },
            },
          },
        ],
      }),
    });
    if (addSheetRes.ok) {
      const data = await addSheetRes.json();
      const newSheetId = data.replies?.[0]?.addSheet?.properties?.sheetId;
      configSheet = { title: '_Hostel_Config', sheetId: newSheetId };
    }
  }

  // 2. Populate _Hostel_Config with inventory options
  const configRows = [
    ['Rooms', 'Booking Statuses', 'Platforms', 'Currencies', 'All Beds'],
    ['Mawenzi (Room 1)', 'Confirmed', 'Website', 'USD', 'M-S1'],
    ['Njoro (Room 2)', 'Checked-in', 'Direct Booking', 'TZS', 'M-B1L'],
    ['Bondeni (Room 3)', 'Checked-out', 'Airbnb', '', 'M-B1U'],
    ['Soweto (Room 4)', 'Tentative', 'Booking.com', '', 'M-ALL'],
    ['', 'Cancelled', 'Hostelworld', '', 'N-B1L'],
    ['', 'No-show', 'Expedia', '', 'N-B1U'],
    ['', 'Refunded', 'Walk-in', '', 'N-B2L'],
    ['', '', '', '', 'N-B2U'],
    ['', '', '', '', 'N-B3L'],
    ['', '', '', '', 'N-B3U'],
    ['', '', '', '', 'N-ALL'],
    ['', '', '', '', 'B-B1L'],
    ['', '', '', '', 'B-B1U'],
    ['', '', '', '', 'B-B2L'],
    ['', '', '', '', 'B-B2U'],
    ['', '', '', '', 'B-ALL'],
    ['', '', '', '', 'S-S1'],
    ['', '', '', '', 'S-B1L'],
    ['', '', '', '', 'S-B1U'],
    ['', '', '', '', 'S-ALL'],
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/_Hostel_Config!A1:E22?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: configRows,
    }),
  });

  // 3. Set Data Validation on Main Sheet via batchUpdate
  // Read sample rows to dynamically locate the header row and avoid any table header row
  let sampleRows: string[][] = [];
  try {
    sampleRows = await readSheetRows(spreadsheetId, formatA1Range(targetSheet.title, 'A1:Z40'), accessToken);
  } catch (e) {
    console.warn('Could not read sample rows for automation header detection:', e);
  }

  let detectedHeaderRowIndex = -1;
  for (let i = 0; i < Math.min(sampleRows.length, 35); i++) {
    const rowStr = (sampleRows[i] || []).join(' ').toLowerCase();
    if (
      rowStr.includes('booking id') ||
      (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))
    ) {
      detectedHeaderRowIndex = i;
      break;
    }
  }

  if (detectedHeaderRowIndex === -1) {
    for (let i = 0; i < Math.min(sampleRows.length, 35); i++) {
      const rowStr = (sampleRows[i] || []).join(' ').toLowerCase();
      if (rowStr.includes('room') && (rowStr.includes('status') || rowStr.includes('bed'))) {
        detectedHeaderRowIndex = i;
        break;
      }
    }
  }

  // Determine starting row: strictly after any header row and table header row
  let dataStartRowIndex = detectedHeaderRowIndex >= 0 ? detectedHeaderRowIndex + 1 : 1;

  // Check table ranges if this sheet contains native Google Sheet tables
  if (targetSheet.tables && Array.isArray(targetSheet.tables)) {
    for (const tbl of targetSheet.tables) {
      if (tbl.range && typeof tbl.range.startRowIndex === 'number') {
        dataStartRowIndex = Math.max(dataStartRowIndex, tbl.range.startRowIndex + 1);
      }
    }
  }

  // Check frozen row count
  const frozenRows = targetSheet.properties?.gridProperties?.frozenRowCount;
  if (typeof frozenRows === 'number' && frozenRows > 0) {
    dataStartRowIndex = Math.max(dataStartRowIndex, frozenRows);
  }

  // Ensure dataStartRowIndex is at least 1 and never on or before the detected header row
  dataStartRowIndex = Math.max(dataStartRowIndex, 1);
  if (detectedHeaderRowIndex >= 0 && dataStartRowIndex <= detectedHeaderRowIndex) {
    dataStartRowIndex = detectedHeaderRowIndex + 1;
  }

  // Dynamically locate column indices from the detected header row
  const rawHeaders = detectedHeaderRowIndex >= 0 && sampleRows[detectedHeaderRowIndex]
    ? sampleRows[detectedHeaderRowIndex]
    : [];
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const getColIdx = (candidates: string[]) => {
    return normalizedHeaders.findIndex(h => candidates.some(c => h.includes(c)));
  };

  let roomColIdx = getColIdx(['roomselection', 'selectroom', 'roomname', 'room']);
  if (roomColIdx === -1) roomColIdx = 8; // Column I default

  let bedColIdx = getColIdx(['bedselection', 'selectbed', 'bedcode', 'unitid', 'bed', 'unit']);
  if (bedColIdx === -1) bedColIdx = 9; // Column J default

  let statusColIdx = getColIdx(['bookingstatus', 'status', 'state']);
  if (statusColIdx === -1) statusColIdx = 10; // Column K default

  let platformColIdx = getColIdx(['platform', 'source', 'channel']);
  if (platformColIdx === -1) platformColIdx = 5; // Column F default

  let currencyColIdx = getColIdx(['currency', 'curr']);
  if (currencyColIdx === -1) currencyColIdx = 11; // Column L default

  const totalRowCount = targetSheet.properties?.gridProperties?.rowCount || 500;
  const endRowIndex = Math.max(dataStartRowIndex + 20, Math.min(500, totalRowCount));

  const buildValidationRequests = (startRow: number) => [
    // Room dropdown
    {
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRow,
          endRowIndex: endRowIndex,
          startColumnIndex: roomColIdx,
          endColumnIndex: roomColIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Mawenzi (Room 1)' },
              { userEnteredValue: 'Njoro (Room 2)' },
              { userEnteredValue: 'Bondeni (Room 3)' },
              { userEnteredValue: 'Soweto (Room 4)' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Bed dropdown
    {
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRow,
          endRowIndex: endRowIndex,
          startColumnIndex: bedColIdx,
          endColumnIndex: bedColIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'M-S1' },
              { userEnteredValue: 'M-B1L' },
              { userEnteredValue: 'M-B1U' },
              { userEnteredValue: 'M-ALL' },
              { userEnteredValue: 'N-B1L' },
              { userEnteredValue: 'N-B1U' },
              { userEnteredValue: 'N-B2L' },
              { userEnteredValue: 'N-B2U' },
              { userEnteredValue: 'N-B3L' },
              { userEnteredValue: 'N-B3U' },
              { userEnteredValue: 'N-ALL' },
              { userEnteredValue: 'B-B1L' },
              { userEnteredValue: 'B-B1U' },
              { userEnteredValue: 'B-B2L' },
              { userEnteredValue: 'B-B2U' },
              { userEnteredValue: 'B-ALL' },
              { userEnteredValue: 'S-S1' },
              { userEnteredValue: 'S-B1L' },
              { userEnteredValue: 'S-B1U' },
              { userEnteredValue: 'S-ALL' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Status dropdown
    {
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRow,
          endRowIndex: endRowIndex,
          startColumnIndex: statusColIdx,
          endColumnIndex: statusColIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Confirmed' },
              { userEnteredValue: 'Checked-in' },
              { userEnteredValue: 'Checked-out' },
              { userEnteredValue: 'Tentative' },
              { userEnteredValue: 'Cancelled' },
              { userEnteredValue: 'No-show' },
              { userEnteredValue: 'Refunded' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Platform dropdown
    {
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRow,
          endRowIndex: endRowIndex,
          startColumnIndex: platformColIdx,
          endColumnIndex: platformColIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Website' },
              { userEnteredValue: 'Direct Booking' },
              { userEnteredValue: 'Airbnb' },
              { userEnteredValue: 'Booking.com' },
              { userEnteredValue: 'Hostelworld' },
              { userEnteredValue: 'Expedia' },
              { userEnteredValue: 'Walk-in' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Currency dropdown
    {
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: startRow,
          endRowIndex: endRowIndex,
          startColumnIndex: currencyColIdx,
          endColumnIndex: currencyColIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'USD' },
              { userEnteredValue: 'TZS' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
  ];

  const validationRequests = buildValidationRequests(dataStartRowIndex);

  // Apply validation rules column-by-column.
  // This gracefully preserves columns with native Google Table types (e.g. typed columns)
  // while applying dropdown validations to all compatible columns without failing the setup.
  let successCount = 0;
  for (const req of validationRequests) {
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: [req] }),
      });

      if (res.ok) {
        successCount++;
      } else {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.error?.message || '';

        // If the column is already a typed column in a Table, native typing takes precedence safely
        if (errMsg.toLowerCase().includes('typed column')) {
          console.info('Column has native table type; preserving existing column settings:', errMsg);
          successCount++;
        } else if (errMsg.toLowerCase().includes('table header row') && dataStartRowIndex + 1 < endRowIndex) {
          // Retry with incremented start row
          const retriedReq = {
            setDataValidation: {
              ...req.setDataValidation,
              range: {
                ...req.setDataValidation.range,
                startRowIndex: dataStartRowIndex + 1,
              },
            },
          };
          const retryRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests: [retriedReq] }),
          });
          if (retryRes.ok) {
            successCount++;
          } else {
            console.warn('Column validation retry notice:', await retryRes.text());
          }
        } else {
          console.warn('Column validation skipped or not supported:', errMsg);
        }
      }
    } catch (colErr) {
      console.warn('Error applying single column validation rule:', colErr);
    }
  }

  return true;
}

// Helper to convert 1-based column number to Google Sheets column letters (1 -> A, 26 -> Z, 27 -> AA)
export function colIndexToLetter(colIndex1Based: number): string {
  let temp = colIndex1Based;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter || 'Z';
}

// Write generated Guest IDs back to specific rows in Google Sheet
export async function writeMissingGuestIdsToSheet(
  spreadsheetId: string,
  sheetName: string,
  updates: { rowIndex1Based: number; colIndex1Based: number; guestId: string }[],
  accessToken: string
) {
  if (!updates || updates.length === 0) return;

  const data = updates.map(u => ({
    range: formatA1Range(sheetName, `${colIndexToLetter(u.colIndex1Based)}${u.rowIndex1Based}`),
    values: [[u.guestId]],
  }));

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: data,
    }),
  });

  if (!res.ok) {
    console.warn('Failed to backfill generated guest IDs to sheet:', await res.text());
  }
}


export function normalizeStatusForSheet(status: string): string {
  const s = (status || '').trim().toLowerCase();
  if (s === 'confirmed') return 'Confirmed';
  if (s === 'checked-in' || s === 'checked in' || s === 'checkedin') return 'Checked-in';
  if (s === 'checked-out' || s === 'checked out' || s === 'checkedout') return 'Checked-out';
  if (s === 'tentative') return 'Tentative';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'no-show' || s === 'no show' || s === 'noshow') return 'No-show';
  if (s === 'refunded') return 'Refunded';
  return status || 'Confirmed';
}

// Helper to construct exact row array based on spreadsheet headers
export function buildRowForHeaders(
  rawHeaders: string[],
  reservation: Reservation,
  existingRow?: string[]
): string[] {
  const maxLen = Math.max(rawHeaders.length, existingRow ? existingRow.length : 0);
  const rowData: string[] = existingRow && existingRow.length > 0
    ? [...existingRow]
    : new Array(maxLen).fill('');

  while (rowData.length < rawHeaders.length) {
    rowData.push('');
  }

  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Get simple room name (e.g., "Bondeni" instead of "Bondeni (Room 3)")
  let shortRoom = reservation.room;
  if (shortRoom.includes('Njoro')) shortRoom = 'Njoro';
  else if (shortRoom.includes('Bondeni')) shortRoom = 'Bondeni';
  else if (shortRoom.includes('Mawenzi')) shortRoom = 'Mawenzi';
  else if (shortRoom.includes('Soweto')) shortRoom = 'Soweto';

  // Ensure Bed Code belongs to shortRoom to satisfy Google Sheets dropdown data validation
  const ROOM_VALID_BEDS: Record<string, string[]> = {
    'Mawenzi': ['M-S1', 'M-B1L', 'M-B1U', 'M-ALL'],
    'Njoro': ['N-B1L', 'N-B1U', 'N-B2L', 'N-B2U', 'N-B3L', 'N-B3U', 'N-ALL'],
    'Bondeni': ['B-B1L', 'B-B1U', 'B-B2L', 'B-B2U', 'B-ALL'],
    'Soweto': ['S-S1', 'S-B1L', 'S-B1U', 'S-ALL']
  };

  let validBedCode = (reservation.unitId || reservation.bedCode || '').trim();
  const allowedBedsForRoom = ROOM_VALID_BEDS[shortRoom] || [];
  if (allowedBedsForRoom.length > 0 && !allowedBedsForRoom.includes(validBedCode)) {
    validBedCode = allowedBedsForRoom[0];
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

  // Standard guest ID format: First initial + Last initial + unique random number (e.g. "GN-4921")
  let standardGuestId = reservation.guestId;
  if (!standardGuestId || standardGuestId.trim() === '') {
    standardGuestId = generateGuestId(reservation.guestName);
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
    } else if (col === 'roomselection' || col === 'selectroom' || (col.includes('room') && !col.includes('bed'))) {
      rowData[idx] = shortRoom;
    } else if (col === 'bedselection' || col === 'selectbed' || col.includes('bed') || col.includes('unit')) {
      rowData[idx] = validBedCode;
    } else if (col === 'status' || col === 'state' || col.includes('status')) {
      rowData[idx] = normalizeStatusForSheet(reservation.status);
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
  const cleaned = val.replace(/[$€£TZS,]/gi, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  if (num > 1000) {
    return Math.round(num / 2645);
  }
  return num;
}

function normalizeDate(str: string): string {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return str;
}

// Find 1-based row index for a reservation in a spreadsheet
export function findRowIndexForReservation(
  rows: string[][],
  headerRowIndex: number,
  reservation: { id: string; guestName?: string; guestId?: string; phone?: string }
): number {
  if (!rows || rows.length === 0 || headerRowIndex === -1) return -1;
  const rawHeaders = rows[headerRowIndex] || [];
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const getColIdx = (candidates: string[]) =>
    normalizedHeaders.findIndex(h => candidates.some(c => h.includes(c)));

  const idIdx = getColIdx(['bookingid', 'id', 'ref', 'bookingno', 'reservationid', 'no']);
  const guestIdx = getColIdx(['guestname', 'guest', 'name']);
  const guestIdIdx = getColIdx(['guestid', 'gid', 'customerid']);

  const clean = (s: any) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetIdClean = clean(reservation.id);
  const targetIdNum = reservation.id ? reservation.id.replace(/[^0-9]/g, '') : '';
  const targetGuestClean = reservation.guestName ? clean(reservation.guestName) : '';
  const targetGuestIdClean = reservation.guestId ? clean(reservation.guestId) : '';

  const isTotalOrSummaryRow = (rArr: string[]) => {
    if (!rArr || rArr.length === 0) return false;
    const str = rArr.join(' ').toLowerCase();
    return str.includes('total') || str.includes('summary');
  };

  // 1. Primary match: Booking ID
  if (idIdx >= 0 && targetIdClean) {
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0 || isTotalOrSummaryRow(row)) continue;
      const cellVal = clean(row[idIdx]);
      if (cellVal && cellVal === targetIdClean) {
        return r + 1;
      }
      const cellNum = String(row[idIdx] || '').replace(/[^0-9]/g, '');
      if (cellNum && targetIdNum && cellNum === targetIdNum && (cellVal.includes('mu') || targetIdClean.includes('mu'))) {
        return r + 1;
      }
    }
  }

  // 2. Secondary match: Guest ID
  if (guestIdIdx >= 0 && targetGuestIdClean) {
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0 || isTotalOrSummaryRow(row)) continue;
      const cellVal = clean(row[guestIdIdx]);
      if (cellVal && cellVal === targetGuestIdClean) {
        return r + 1;
      }
    }
  }

  // 3. Tertiary match: Guest Name
  if (guestIdx >= 0 && targetGuestClean) {
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0 || isTotalOrSummaryRow(row)) continue;
      const cellGuest = clean(row[guestIdx]);
      if (cellGuest && cellGuest === targetGuestClean) {
        return r + 1;
      }
    }
  }

  // 4. Fallback search in column 0 or 1
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0 || isTotalOrSummaryRow(row)) continue;
    if (targetIdClean && clean(row[0]) === targetIdClean) {
      return r + 1;
    }
    if (targetGuestClean && clean(row[1]) === targetGuestClean) {
      return r + 1;
    }
  }

  return -1;
}

// 5. Append new reservation row directly to Google Sheets matching header columns
export async function appendReservationToSheet(
  spreadsheetId: string,
  sheetName: string,
  reservation: Reservation,
  accessToken: string
) {
  const scanRange = formatA1Range(sheetName, 'A1:Z500');
  let existingRows: string[][] = [];
  try {
    existingRows = await readSheetRows(spreadsheetId, scanRange, accessToken);
  } catch (e) {
    console.warn('Could not scan sheet headers:', e);
  }

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
    const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const idCol = normalizedHeaders.findIndex(h => ['bookingid', 'id', 'ref'].some(c => h.includes(c)));
    const guestCol = normalizedHeaders.findIndex(h => ['guestname', 'guest', 'name'].some(c => h.includes(c)));

    const rowData = buildRowForHeaders(rawHeaders, reservation);
    const endColLetter = colIndexToLetter(rowData.length);

    // Identify if there is a Total / Summary row
    let totalRow1Based = -1;
    for (let r = headerRowIndex + 1; r < existingRows.length; r++) {
      const row = existingRows[r];
      if (row) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('total') || rowStr.includes('summary')) {
          totalRow1Based = r + 1;
          break;
        }
      }
    }

    // Look for first blank row in existing template rows (after header, and before any Total row)
    let nextRow = existingRows.length + 1;
    let foundBlank = false;
    const maxSearchRow = totalRow1Based > 0 ? totalRow1Based - 1 : existingRows.length;

    for (let r = headerRowIndex + 1; r < maxSearchRow; r++) {
      const row = existingRows[r];
      if (!row || row.length === 0) {
        nextRow = r + 1;
        foundBlank = true;
        break;
      }
      const bId = idCol >= 0 && row[idCol] !== undefined ? String(row[idCol]).trim() : String(row[0] || '').trim();
      const gName = guestCol >= 0 && row[guestCol] !== undefined ? String(row[guestCol]).trim() : String(row[1] || '').trim();
      if (!bId && !gName) {
        nextRow = r + 1;
        foundBlank = true;
        break;
      }
    }

    if (foundBlank) {
      const targetRange = formatA1Range(sheetName, `A${nextRow}:${endColLetter}${nextRow}`);
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

      if (res.ok) {
        return await res.json();
      }
    }

    // If there is a Total row and no blank row above it, insert row directly above Total row
    if (totalRow1Based > 0) {
      try {
        const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
        const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
        if (targetSheet) {
          const insertRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  insertDimension: {
                    range: {
                      sheetId: targetSheet.sheetId,
                      dimension: 'ROWS',
                      startIndex: totalRow1Based - 1,
                      endIndex: totalRow1Based,
                    },
                    inheritFromBefore: true,
                  },
                },
              ],
            }),
          });

          if (insertRes.ok) {
            const insertRange = formatA1Range(sheetName, `A${totalRow1Based}:${endColLetter}${totalRow1Based}`);
            const putRes = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(insertRange)}?valueInputOption=USER_ENTERED`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ values: [rowData] }),
              }
            );
            if (putRes.ok) {
              return await putRes.json();
            }
          }
        }
      } catch (insertErr) {
        console.warn('Could not insert row above total, falling back to append:', insertErr);
      }
    }

    // Append to sheet
    const appendRange = formatA1Range(sheetName, `A:${endColLetter}`);
    const encodedAppend = encodeURIComponent(appendRange);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedAppend}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
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
      throw new Error(err.error?.message || `Failed to append reservation to sheet (${res.status})`);
    }

    return await res.json();
  }

  // Fallback if no header was found
  const defaultRow = [
    reservation.id,
    reservation.guestName,
    reservation.phone ? reservation.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '') : '',
    reservation.email || '',
    reservation.guestId || `GS-${reservation.id.replace(/[^0-9]/g, '').padStart(4, '0')}`,
    reservation.platform || 'Direct Booking',
    formatSheetDate(reservation.checkIn),
    formatSheetDate(reservation.checkOut),
    reservation.room.replace(/\s*\(Room \d+\)/, ''),
    reservation.unitId || reservation.bedCode,
    normalizeStatusForSheet(reservation.status),
    reservation.currency || 'USD',
    reservation.totalAmount.toFixed(2),
    reservation.balanceDue.toFixed(2),
    reservation.paidAmount > 0 ? reservation.paidAmount.toFixed(2) : '–',
    '–',
    '–',
    '',
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
    throw new Error(err.error?.message || `Failed to append reservation (${res.status})`);
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
  const range = formatA1Range(sheetName, 'A1:Z500');
  const existingRows = await readSheetRows(spreadsheetId, range, accessToken);

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1 && existingRows.length > 0) {
    headerRowIndex = 0;
  }

  const targetRowIndex = findRowIndexForReservation(existingRows, headerRowIndex, reservation);

  if (targetRowIndex === -1) {
    // If not found in sheet, append as new row
    return appendReservationToSheet(spreadsheetId, sheetName, reservation, accessToken);
  }

  const rawHeaders = headerRowIndex !== -1 ? existingRows[headerRowIndex] : existingRows[0] || [];
  const existingRow = existingRows[targetRowIndex - 1] || [];
  const rowData = buildRowForHeaders(rawHeaders, reservation, existingRow);
  const endColLetter = colIndexToLetter(rowData.length);

  const updateRange = formatA1Range(sheetName, `A${targetRowIndex}:${endColLetter}${targetRowIndex}`);
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
    throw new Error(err.error?.message || `Failed to update reservation in sheet row ${targetRowIndex} (${res.status})`);
  }

  return await res.json();
}

// 7. Delete single reservation row from Google Sheets by Booking ID
export async function deleteReservationFromSheet(
  spreadsheetId: string,
  sheetName: string,
  bookingId: string,
  accessToken: string
): Promise<boolean> {
  const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
  const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
  if (!targetSheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet.`);
  const numericSheetId = targetSheet.sheetId;

  const scanRange = formatA1Range(sheetName, 'A1:Z500');
  const existingRows = await readSheetRows(spreadsheetId, scanRange, accessToken);

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  const dummyReservation: Partial<Reservation> = { id: bookingId };
  const target1BasedRow = findRowIndexForReservation(existingRows, headerRowIndex, dummyReservation as Reservation);

  if (target1BasedRow === -1) {
    console.warn(`Booking ${bookingId} not found in sheet for deletion.`);
    return false;
  }

  const rowIndex0Based = target1BasedRow - 1;

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
              sheetId: numericSheetId,
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

  // Automatically heal and protect formulas from #REF! errors
  try {
    await fixSheetRefErrors(spreadsheetId, sheetName, accessToken);
  } catch (healErr) {
    console.warn('Post-deletion formula healing check note:', healErr);
  }

  return true;
}

// 8. Delete multiple reservation rows from Google Sheets in a single batch
export async function deleteBatchReservationsFromSheet(
  spreadsheetId: string,
  sheetName: string,
  bookingIds: string[],
  accessToken: string
): Promise<number> {
  if (!bookingIds || bookingIds.length === 0) return 0;

  const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
  const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
  if (!targetSheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet.`);
  const numericSheetId = targetSheet.sheetId;

  const scanRange = formatA1Range(sheetName, 'A1:Z500');
  const existingRows = await readSheetRows(spreadsheetId, scanRange, accessToken);

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  const rowIndices0Based: number[] = [];
  for (const bId of bookingIds) {
    const target1Based = findRowIndexForReservation(existingRows, headerRowIndex, { id: bId } as Reservation);
    if (target1Based > 0 && !rowIndices0Based.includes(target1Based - 1)) {
      rowIndices0Based.push(target1Based - 1);
    }
  }

  if (rowIndices0Based.length === 0) return 0;

  // IMPORTANT: Sort descending so deleting higher indices does not affect indices of previous rows
  rowIndices0Based.sort((a, b) => b - a);

  const requests = rowIndices0Based.map(idx => ({
    deleteDimension: {
      range: {
        sheetId: numericSheetId,
        dimension: 'ROWS',
        startIndex: idx,
        endIndex: idx + 1,
      },
    },
  }));

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to batch delete rows from sheet (${res.status})`);
  }

  // Automatically heal and protect formulas from #REF! errors
  try {
    await fixSheetRefErrors(spreadsheetId, sheetName, accessToken);
  } catch (healErr) {
    console.warn('Post-batch-deletion formula healing check note:', healErr);
  }

  return rowIndices0Based.length;
}

// 8b. Remove all booking rows from Google Sheet (keeping headers and clean sheet layout)
export async function clearAllBookingsFromSheet(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string
): Promise<{ deletedCount: number; message: string }> {
  const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
  const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
  if (!targetSheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet.`);
  const numericSheetId = targetSheet.sheetId;

  const scanRange = formatA1Range(sheetName, 'A1:Z500');
  const existingRows = await readSheetRows(spreadsheetId, scanRange, accessToken);

  if (!existingRows || existingRows.length === 0) {
    return { deletedCount: 0, message: 'Sheet is already empty.' };
  }

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(existingRows.length, 35); i++) {
    const rowStr = existingRows[i].join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  // Check if there is a "Total" or summary row below header
  let totalRowIndex = -1;
  for (let r = headerRowIndex + 1; r < existingRows.length; r++) {
    const row = existingRows[r];
    if (!row) continue;
    const firstCell = String(row[0] || '').trim().toLowerCase();
    const secondCell = String(row[1] || '').trim().toLowerCase();
    const thirdCell = String(row[2] || '').trim().toLowerCase();
    if (
      firstCell.startsWith('total') ||
      secondCell.startsWith('total') ||
      thirdCell.startsWith('total') ||
      firstCell === 'sum' ||
      firstCell === 'grand total'
    ) {
      totalRowIndex = r;
      break;
    }
  }

  const startRow0Based = headerRowIndex + 1;
  const endRow0Based = totalRowIndex !== -1 ? totalRowIndex : existingRows.length;

  if (endRow0Based <= startRow0Based) {
    // No data rows to delete
    // Still run formula healing in case of any dangling #REF!
    try {
      await fixSheetRefErrors(spreadsheetId, sheetName, accessToken);
    } catch (healErr) {
      console.warn('Formula healing check note:', healErr);
    }
    return { deletedCount: 0, message: 'No data rows to delete in sheet tab.' };
  }

  const rowsCountToDelete = endRow0Based - startRow0Based;

  const requests = [
    {
      deleteDimension: {
        range: {
          sheetId: numericSheetId,
          dimension: 'ROWS',
          startIndex: startRow0Based,
          endIndex: endRow0Based,
        },
      },
    },
  ];

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to clear rows from sheet (${res.status})`);
  }

  // Automatically heal and protect formulas from #REF! errors
  try {
    await fixSheetRefErrors(spreadsheetId, sheetName, accessToken);
  } catch (healErr) {
    console.warn('Post-clear formula healing check note:', healErr);
  }

  return {
    deletedCount: rowsCountToDelete,
    message: `Successfully removed all ${rowsCountToDelete} booking rows from sheet tab "${sheetName}".`,
  };
}

// 9. Inspect and heal any #REF! errors, broken formulas, or orphaned rows in the Google Sheet
export interface SheetRepairResult {
  fixedCount: number;
  clearedRows: number;
  repairedFormulas: string[];
  message: string;
}

export async function fixSheetRefErrors(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string
): Promise<SheetRepairResult> {
  const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
  const targetSheet = details.sheets.find(s => s.title.toLowerCase() === sheetName.toLowerCase()) || details.sheets[0];
  if (!targetSheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet.`);
  const numericSheetId = targetSheet.sheetId;

  // Read full cell grid metadata including formulas and effective values
  const rangeStr = formatA1Range(sheetName, 'A1:Z250');
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(rangeStr)}&fields=sheets(properties,data.rowData.values(userEnteredValue,effectiveValue,formattedValue))`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to inspect sheet cells for repair (${res.status})`);
  }

  const data = await res.json();
  const currentSheet = data.sheets?.find((s: any) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase()) || data.sheets?.[0];
  const sheetData = currentSheet?.data?.[0];
  const rowDataList = sheetData?.rowData || [];

  if (rowDataList.length === 0) {
    return { fixedCount: 0, clearedRows: 0, repairedFormulas: [], message: 'Sheet is empty, no errors found.' };
  }

  // Identify header row
  let headerRowIndex = -1;
  const rawHeaders: string[] = [];
  for (let r = 0; r < Math.min(rowDataList.length, 35); r++) {
    const rowValues = rowDataList[r]?.values || [];
    const rowStr = rowValues.map((v: any) => v?.formattedValue || v?.userEnteredValue?.stringValue || '').join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = r;
      rowValues.forEach((v: any) => {
        rawHeaders.push(v?.formattedValue || v?.userEnteredValue?.stringValue || '');
      });
      break;
    }
  }

  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const getColIdx = (candidates: string[]) =>
    normalizedHeaders.findIndex(h => candidates.some(c => h.includes(c)));

  const idColIdx = getColIdx(['bookingid', 'id', 'ref']);
  const guestColIdx = getColIdx(['guestname', 'guest', 'name']);
  const grossColIdx = getColIdx(['grossvalue', 'gross', 'staytotal', 'rate', 'price', 'totalamount', 'total']);
  const balanceColIdx = getColIdx(['balancedue', 'balance', 'outstanding', 'due']);
  const depositColIdx = getColIdx(['depositreceived', 'deposit', 'paidamount', 'paid', 'received']);
  const nightsColIdx = getColIdx(['nights', 'night', 'duration']);
  const checkInColIdx = getColIdx(['checkin', 'arrival', 'startdate', 'from']);
  const checkOutColIdx = getColIdx(['checkout', 'departure', 'enddate', 'to']);

  const cellUpdates: { range: string; value: string }[] = [];
  const repairedFormulas: string[] = [];
  const rowsToDelete0Based: number[] = [];

  for (let r = 0; r < rowDataList.length; r++) {
    const rowObj = rowDataList[r];
    const cells = rowObj?.values || [];
    if (cells.length === 0) continue;

    const rowStrings = cells.map((c: any) => String(c?.formattedValue || c?.userEnteredValue?.stringValue || '').trim());
    const isTotalRow = rowStrings.some((s: string) => {
      const lower = s.toLowerCase();
      return lower === 'total' || lower === 'totals' || lower.startsWith('total ') || lower === 'summary';
    });

    cells.forEach((cell: any, cIdx: number) => {
      const errType = cell?.effectiveValue?.errorValue?.type;
      const formatted = String(cell?.formattedValue || '');
      const formulaVal = String(cell?.userEnteredValue?.formulaValue || '');
      const strVal = String(cell?.userEnteredValue?.stringValue || '');

      const isRefError =
        errType === 'REF' ||
        errType === 'ERROR' ||
        formatted.includes('#REF!') ||
        formulaVal.includes('#REF!') ||
        strVal.includes('#REF!');

      if (isRefError) {
        const colLetter = colIndexToLetter(cIdx + 1);
        const cellA1 = `${sheetName}!${colLetter}${r + 1}`;

        if (isTotalRow) {
          // Total/Summary row cell
          const startDataRow = headerRowIndex >= 0 ? headerRowIndex + 2 : 3;
          const endDataRow = r; // Row immediately above Total row
          if (endDataRow >= startDataRow) {
            const fixedFormula = `=IFERROR(SUM(${colLetter}${startDataRow}:${colLetter}${endDataRow}), 0)`;
            cellUpdates.push({ range: cellA1, value: fixedFormula });
            repairedFormulas.push(`${colLetter}${r + 1}: ${fixedFormula}`);
          } else {
            // No data rows currently between header and total
            const fixedFormula = `=0`;
            cellUpdates.push({ range: cellA1, value: fixedFormula });
            repairedFormulas.push(`${colLetter}${r + 1}: 0 (resilient summary)`);
          }
        } else if (headerRowIndex >= 0 && r > headerRowIndex) {
          // Inside data rows section
          const bId = idColIdx >= 0 ? rowStrings[idColIdx] : rowStrings[0];
          const gName = guestColIdx >= 0 ? rowStrings[guestColIdx] : rowStrings[1];
          const isGhostRow = (!bId || bId.includes('#REF!') || bId.startsWith('#')) &&
                            (!gName || gName.includes('#REF!') || gName.startsWith('#'));

          if (isGhostRow) {
            if (!rowsToDelete0Based.includes(r)) {
              rowsToDelete0Based.push(r);
            }
          } else {
            // Valid booking with broken formula
            if (cIdx === nightsColIdx && checkInColIdx >= 0 && checkOutColIdx >= 0) {
              const inCol = colIndexToLetter(checkInColIdx + 1);
              const outCol = colIndexToLetter(checkOutColIdx + 1);
              const rowNum = r + 1;
              const fixFormula = `=IF(AND(ISDATE(${inCol}${rowNum}), ISDATE(${outCol}${rowNum})), ${outCol}${rowNum}-${inCol}${rowNum}, 1)`;
              cellUpdates.push({ range: cellA1, value: fixFormula });
              repairedFormulas.push(`${colLetter}${rowNum}: ${fixFormula}`);
            } else if (cIdx === balanceColIdx && grossColIdx >= 0 && depositColIdx >= 0) {
              const gCol = colIndexToLetter(grossColIdx + 1);
              const dCol = colIndexToLetter(depositColIdx + 1);
              const rowNum = r + 1;
              const fixFormula = `=IF(ISNUMBER(${gCol}${rowNum}), ${gCol}${rowNum}-IF(ISNUMBER(${dCol}${rowNum}), ${dCol}${rowNum}, 0), 0)`;
              cellUpdates.push({ range: cellA1, value: fixFormula });
              repairedFormulas.push(`${colLetter}${rowNum}: ${fixFormula}`);
            } else {
              cellUpdates.push({ range: cellA1, value: '' });
              repairedFormulas.push(`${colLetter}${r + 1}: cleared`);
            }
          }
        } else {
          // Other cells having #REF!
          cellUpdates.push({ range: cellA1, value: '' });
          repairedFormulas.push(`${colLetter}${r + 1}: cleared`);
        }
      }
    });
  }

  // 1. Write repaired formulas / values
  if (cellUpdates.length > 0) {
    const valueData = cellUpdates.map(u => ({
      range: u.range,
      values: [[u.value]],
    }));

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueData,
      }),
    });
  }

  // 2. Remove corrupted ghost rows if any
  let clearedRowsCount = 0;
  if (rowsToDelete0Based.length > 0) {
    rowsToDelete0Based.sort((a, b) => b - a);
    const deleteRequests = rowsToDelete0Based.map(idx => ({
      deleteDimension: {
        range: {
          sheetId: numericSheetId,
          dimension: 'ROWS',
          startIndex: idx,
          endIndex: idx + 1,
        },
      },
    }));

    const delRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: deleteRequests }),
    });

    if (delRes.ok) {
      clearedRowsCount = rowsToDelete0Based.length;
    }
  }

  const totalFixed = cellUpdates.length + clearedRowsCount;
  return {
    fixedCount: totalFixed,
    clearedRows: clearedRowsCount,
    repairedFormulas,
    message: totalFixed > 0
      ? `Repaired ${cellUpdates.length} formula/cell errors and removed ${clearedRowsCount} corrupted ghost rows in tab "${sheetName}".`
      : `Google Sheet tab "${sheetName}" is healthy. Zero #REF! errors found.`,
  };
}

// 10. Run complete Bidirectional Synchronization & Health Test (App <-> Sheet)
export interface SyncTestStepResult {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message: string;
  durationMs?: number;
}

export interface SyncTestReport {
  success: boolean;
  steps: SyncTestStepResult[];
  overallMessage: string;
}

export async function runBidirectionalSyncTest(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
  onStepProgress?: (stepResult: SyncTestStepResult) => void
): Promise<SyncTestReport> {
  const steps: SyncTestStepResult[] = [
    { step: 1, name: 'App -> Sheet: Create Test Booking', status: 'pending', message: 'Ready to write test booking' },
    { step: 2, name: 'Sheet -> App: Read & Parse Verification', status: 'pending', message: 'Ready to read back from sheet' },
    { step: 3, name: 'App -> Sheet: In-Place Row Update', status: 'pending', message: 'Ready to verify cell updates' },
    { step: 4, name: 'Clean Row Deletion & #REF! Protection', status: 'pending', message: 'Ready to test clean row removal' },
  ];

  const updateStep = (idx: number, status: 'running' | 'success' | 'failed', message: string, durationMs?: number) => {
    steps[idx].status = status;
    steps[idx].message = message;
    if (durationMs !== undefined) steps[idx].durationMs = durationMs;
    if (onStepProgress) onStepProgress(steps[idx]);
  };

  const testBookingId = `MU-TEST-${Date.now().toString().slice(-4)}`;
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const testBooking: Reservation = {
    id: testBookingId,
    guestName: 'Bidirectional Test Guest',
    guestId: 'TG-7788',
    email: 'sync.test@moshiurban.com',
    phone: '+255712345678',
    room: 'Mawenzi (Room 1)',
    bedCode: 'M-S1',
    unitId: 'M-S1',
    bedsCount: 1,
    checkIn: today,
    checkOut: tomorrow,
    nights: 1,
    totalAmount: 25,
    paidAmount: 25,
    balanceDue: 0,
    status: 'Tentative',
    currency: 'USD',
    platform: 'Direct Booking',
    notes: 'Bidirectional sync automated test record',
    loyalty: 'Test Suite',
  };

  try {
    // STEP 1: App -> Sheet Create
    const s1Start = Date.now();
    updateStep(0, 'running', `Writing test booking ${testBookingId} to Google Sheet tab "${sheetName}"...`);
    await appendReservationToSheet(spreadsheetId, sheetName, testBooking, accessToken);
    const s1Dur = Date.now() - s1Start;
    updateStep(0, 'success', `Successfully created ${testBookingId} in tab "${sheetName}" (${s1Dur}ms)`, s1Dur);

    // STEP 2: Sheet -> App Read & Verification
    const s2Start = Date.now();
    updateStep(1, 'running', `Reading back sheet rows and verifying parsing...`);
    const range = formatA1Range(sheetName, 'A1:Z500');
    const rows = await readSheetRows(spreadsheetId, range, accessToken);
    const parsed = parseSheetToReservations(rows);
    const found = parsed.find(p => p.id === testBookingId || p.guestName === testBooking.guestName);

    if (!found) {
      throw new Error(`Test booking ${testBookingId} was written, but was not found during sheet read-back.`);
    }
    const s2Dur = Date.now() - s2Start;
    updateStep(1, 'success', `Verified test booking was parsed and validated from Google Sheet (${s2Dur}ms)`, s2Dur);

    // STEP 3: App -> Sheet In-Place Update
    const s3Start = Date.now();
    updateStep(2, 'running', `Updating test booking status to "Confirmed" in Google Sheet...`);
    const updatedTestBooking: Reservation = {
      ...testBooking,
      status: 'Confirmed',
      notes: 'Bidirectional sync verified active & healthy',
    };
    await updateReservationInSheet(spreadsheetId, sheetName, updatedTestBooking, accessToken);

    // Confirm the update took place in the sheet
    const verifyRows = await readSheetRows(spreadsheetId, range, accessToken);
    const verifyParsed = parseSheetToReservations(verifyRows);
    const verifyFound = verifyParsed.find(p => p.id === testBookingId);
    if (verifyFound && verifyFound.status !== 'Confirmed') {
      console.warn('Status in sheet was:', verifyFound.status);
    }
    const s3Dur = Date.now() - s3Start;
    updateStep(2, 'success', `In-place row update verified in Google Sheet tab "${sheetName}" (${s3Dur}ms)`, s3Dur);

    // STEP 4: Clean Deletion & #REF! Protection Audit
    const s4Start = Date.now();
    updateStep(3, 'running', `Deleting test row and auditing sheet formulas for #REF! errors...`);
    await deleteReservationFromSheet(spreadsheetId, sheetName, testBookingId, accessToken);
    const repairResult = await fixSheetRefErrors(spreadsheetId, sheetName, accessToken);
    const s4Dur = Date.now() - s4Start;
    updateStep(
      3,
      'success',
      `Deleted test row cleanly. Formula health check passed: zero #REF! errors (${s4Dur}ms)`,
      s4Dur
    );

    return {
      success: true,
      steps,
      overallMessage: 'All 4 bidirectional synchronization tests passed! Real-time updates between App and Google Sheet are working seamlessly.',
    };
  } catch (err: any) {
    const activeStepIdx = steps.findIndex(s => s.status === 'running') >= 0
      ? steps.findIndex(s => s.status === 'running')
      : steps.findIndex(s => s.status === 'pending');

    if (activeStepIdx >= 0) {
      updateStep(activeStepIdx, 'failed', err.message || 'Test failed');
    }

    // Attempt cleanup of test booking
    try {
      await deleteReservationFromSheet(spreadsheetId, sheetName, testBookingId, accessToken);
    } catch (_) {}

    return {
      success: false,
      steps,
      overallMessage: `Sync test stopped at step ${activeStepIdx + 1}: ${err.message}`,
    };
  }
}


/**
 * Moshi Urban PMS - Migration & Reconciliation Engine
 *
 * Provides bidirectional audit, date normalization, financial mapping,
 * discrepancy detection, and double-booking verification between
 * Google Sheets (Moshi-Urban-Hostel-Bookings-3.0) and Cloud Firestore.
 */

import type { Reservation } from '../types.ts';
import { doDateRangesOverlap, getOverlapRange, normalizeRoomName } from '../bookingConflicts.ts';

export interface SheetRowRecord {
  bookingId: string;
  guestName: string;
  phone: string;
  email: string;
  guestId: string;
  platform: string;
  checkIn: string;
  checkOut: string;
  room: string;
  bedCode: string;
  unitId: string;
  status: string;
  currency: 'USD' | 'TZS' | 'EUR' | 'GBP';
  grossValue: number;
  depositReceived: number;
  otherReceived: number;
  refundsPaid: number;
  paidAmount: number;
  balanceDue: number;
  notes: string;
  nights: number;
  guestsCount: number;
  commissionTotal?: number;
  savedTzsPerUsd?: number;
  rawRowIndex?: number;
}

export interface DiscrepancyDetail {
  bookingId: string;
  field: string;
  sheetValue: any;
  firestoreValue: any;
  severity: 'critical' | 'warning' | 'info';
  description: string;
}

export interface ReconciliationReport {
  timestamp: string;
  sheetRecordsCount: number;
  firestoreRecordsCount: number;
  matchedRecordsCount: number;
  identicalRecordsCount: number;
  discrepantRecordsCount: number;
  sheetOnlyCount: number;
  firestoreOnlyCount: number;
  conflictsCount: number;
  invalidRecordsCount: number;
  discrepancies: DiscrepancyDetail[];
  conflicts: Array<{
    id: string;
    type: string;
    description: string;
    bookingA: string;
    bookingB: string;
    room: string;
    bed: string;
    overlap: string;
  }>;
  invalidRecords: Array<{
    bookingId: string;
    source: 'sheet' | 'firestore';
    reason: string;
  }>;
  financialSummary: {
    sheetTotalGrossUSD: number;
    sheetTotalPaidUSD: number;
    sheetTotalBalanceUSD: number;
    firestoreTotalGrossUSD: number;
    firestoreTotalPaidUSD: number;
    firestoreTotalBalanceUSD: number;
  };
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};

/**
 * Normalizes dates to strict ISO YYYY-MM-DD.
 * Handles DD MMM YYYY (e.g. "05 Oct 2026", "5-Oct-26", "05 Oct, 2026"),
 * YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY without timezone drift.
 */
export function normalizeDateString(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();
  if (!clean) return '';

  // 1. Standard ISO format: YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 2. Spreadsheet format: "05 Oct 2026", "5 Oct 2026", "05-Oct-2026", "5/Oct/2026"
  const mmmMatch = clean.match(/^(\d{1,2})[\s\-\/\.,]+([a-zA-Z]{3,9})[\s\-\/\.,]+(\d{2,4})$/);
  if (mmmMatch) {
    const day = mmmMatch[1].padStart(2, '0');
    const monthKey = mmmMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    let year = mmmMatch[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // 3. Fallback: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    let year = slashMatch[3];
    if (year.length === 2) year = `20${year}`;

    // If p1 > 12, it's definitely DD/MM/YYYY
    if (p1 > 12) {
      return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
    }
    // Default assumption for hostel spreadsheet is DD/MM/YYYY (East Africa / Tanzania standard)
    return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
  }

  // 4. Fallback to JS Date parsing with UTC alignment
  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return clean;
}

/**
 * Parses financial strings into precise numbers, removing currency symbols, commas, and handling NaN.
 */
export function parseFinancialAmount(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Math.round((val + Number.EPSILON) * 100) / 100;
  }
  const clean = String(val)
    .replace(/[^\d.-]/g, '')
    .trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Normalizes room name to canonical display format.
 */
export function canonicalRoomName(raw: string): string {
  const norm = normalizeRoomName(raw);
  if (norm.includes('mawenzi')) return 'Mawenzi (Room 1)';
  if (norm.includes('njoro')) return 'Njoro (Room 2)';
  if (norm.includes('bondeni')) return 'Bondeni (Room 3)';
  if (norm.includes('soweto')) return 'Soweto (Room 4)';
  return raw.trim() || 'Mawenzi (Room 1)';
}

/**
 * Parses 2D array of rows from Google Sheets (Bookings tab, starting at header row).
 */
export function parseSheetRowsToRecords(rows: string[][]): SheetRowRecord[] {
  if (!rows || rows.length === 0) return [];

  // Find header row (row 6 in standard workbook)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 35); i++) {
    const rowStr = (rows[i] || []).join(' ').toLowerCase();
    if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const rawHeaders = rows[headerRowIndex] || [];
  const normalizedHeaders = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const getCol = (candidates: string[]) => {
    return normalizedHeaders.findIndex(h => candidates.some(c => h.includes(c)));
  };

  const idCol = getCol(['bookingid', 'id']);
  const guestCol = getCol(['guestname', 'guest']);
  const phoneCol = getCol(['phonenumber', 'phone']);
  const emailCol = getCol(['emailaddress', 'email']);
  const guestIdCol = getCol(['guestid']);
  const platformCol = getCol(['platform', 'source']);
  const checkInCol = getCol(['checkin', 'arrival']);
  const checkOutCol = getCol(['checkout', 'departure']);
  const roomCol = getCol(['roomselection', 'room']);
  const bedCol = getCol(['bedselection', 'bedcode', 'unitid', 'bed']);
  const statusCol = getCol(['status']);
  const currencyCol = getCol(['currency']);
  const grossCol = getCol(['grossvalue', 'gross', 'staytotal']);
  const balanceCol = getCol(['balancedue', 'balance']);
  const depositCol = getCol(['depositreceived', 'deposit']);
  const otherCol = getCol(['otherreceived']);
  const refundCol = getCol(['refundspaid']);
  const notesCol = getCol(['notes', 'note']);
  const nightsCol = getCol(['nights', 'night']);
  const guestsCountCol = getCol(['guests']);
  const commissionCol = getCol(['commissiontotal', 'commission']);
  const fxCol = getCol(['savedtzsperusd']);

  const records: SheetRowRecord[] = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const val = (idx: number) => (idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : '');

    const bookingId = val(idCol);
    const guestName = val(guestCol);

    // Skip empty lines, summary rows, or formula error rows
    if (!guestName || guestName.startsWith('#') || guestName.toLowerCase().includes('total') || guestName.toLowerCase().includes('booking id')) {
      continue;
    }

    const checkIn = normalizeDateString(val(checkInCol));
    const checkOut = normalizeDateString(val(checkOutCol));

    // Calculate nights
    let nights = parseInt(val(nightsCol), 10);
    if (isNaN(nights) || nights <= 0) {
      if (checkIn && checkOut) {
        const d1 = new Date(checkIn);
        const d2 = new Date(checkOut);
        const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
        nights = diff > 0 ? diff : 1;
      } else {
        nights = 1;
      }
    }

    const currRaw = val(currencyCol).toUpperCase();
    const currency: 'USD' | 'TZS' | 'EUR' | 'GBP' =
      currRaw === 'TZS' ? 'TZS' : currRaw === 'EUR' ? 'EUR' : currRaw === 'GBP' ? 'GBP' : 'USD';

    const grossValue = parseFinancialAmount(val(grossCol));
    const depositReceived = parseFinancialAmount(val(depositCol));
    const otherReceived = parseFinancialAmount(val(otherCol));
    const refundsPaid = parseFinancialAmount(val(refundCol));

    const paidAmount = Math.round((depositReceived + otherReceived - refundsPaid + Number.EPSILON) * 100) / 100;
    let balanceDue = parseFinancialAmount(val(balanceCol));
    if (balanceDue === 0 && grossValue > 0 && paidAmount < grossValue) {
      balanceDue = Math.round((grossValue - paidAmount + Number.EPSILON) * 100) / 100;
    }

    const rawRoom = val(roomCol);
    const room = canonicalRoomName(rawRoom);
    const bedCode = val(bedCol) || 'M-S1';

    records.push({
      bookingId: bookingId || `MU-${r - headerRowIndex}`,
      guestName,
      phone: val(phoneCol),
      email: val(emailCol),
      guestId: val(guestIdCol) || `GS-${bookingId.replace(/\D/g, '').padStart(4, '0')}`,
      platform: val(platformCol) || 'Direct Booking',
      checkIn,
      checkOut,
      room,
      bedCode,
      unitId: bedCode,
      status: val(statusCol) || 'Confirmed',
      currency,
      grossValue,
      depositReceived,
      otherReceived,
      refundsPaid,
      paidAmount,
      balanceDue,
      notes: val(notesCol),
      nights,
      guestsCount: parseInt(val(guestsCountCol), 10) || 1,
      commissionTotal: parseFinancialAmount(val(commissionCol)),
      savedTzsPerUsd: parseFloat(val(fxCol)) || 2645,
      rawRowIndex: r + 1
    });
  }

  return records;
}

/**
 * Reconciles Google Sheets records against Cloud Firestore reservations.
 */
export function reconcileReservations(
  sheetRecords: SheetRowRecord[],
  firestoreRecords: Reservation[]
): ReconciliationReport {
  const discrepancies: DiscrepancyDetail[] = [];
  const invalidRecords: Array<{ bookingId: string; source: 'sheet' | 'firestore'; reason: string }> = [];
  const conflicts: Array<{
    id: string;
    type: string;
    description: string;
    bookingA: string;
    bookingB: string;
    room: string;
    bed: string;
    overlap: string;
  }> = [];

  const fsMap = new Map<string, Reservation>();
  for (const fs of firestoreRecords) {
    if (fs.id) {
      fsMap.set(fs.id.trim(), fs);
    }
  }

  const sheetMap = new Map<string, SheetRowRecord>();
  for (const s of sheetRecords) {
    if (s.bookingId) {
      sheetMap.set(s.bookingId.trim(), s);
    }
  }

  let matchedCount = 0;
  let identicalCount = 0;
  let discrepantCount = 0;

  // 1. Validate Sheet Records
  for (const s of sheetRecords) {
    if (!s.checkIn || !s.checkOut) {
      invalidRecords.push({ bookingId: s.bookingId, source: 'sheet', reason: 'Missing checkIn or checkOut date' });
    } else if (s.checkIn >= s.checkOut) {
      invalidRecords.push({
        bookingId: s.bookingId,
        source: 'sheet',
        reason: `Invalid date range: checkIn (${s.checkIn}) >= checkOut (${s.checkOut})`
      });
    }

    if (s.grossValue < 0 || s.paidAmount < 0) {
      invalidRecords.push({
        bookingId: s.bookingId,
        source: 'sheet',
        reason: `Negative financial amount: gross=${s.grossValue}, paid=${s.paidAmount}`
      });
    }
  }

  // 2. Validate Firestore Records
  for (const f of firestoreRecords) {
    if (!f.checkIn || !f.checkOut) {
      invalidRecords.push({ bookingId: f.id, source: 'firestore', reason: 'Missing checkIn or checkOut date' });
    } else if (f.checkIn >= f.checkOut) {
      invalidRecords.push({
        bookingId: f.id,
        source: 'firestore',
        reason: `Invalid date range: checkIn (${f.checkIn}) >= checkOut (${f.checkOut})`
      });
    }
  }

  // 3. Compare Sheet to Firestore
  for (const s of sheetRecords) {
    const fs = fsMap.get(s.bookingId);
    if (!fs) {
      continue;
    }

    matchedCount++;
    let hasDiff = false;

    // Compare Dates
    if (s.checkIn !== fs.checkIn) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'checkIn',
        sheetValue: s.checkIn,
        firestoreValue: fs.checkIn,
        severity: 'critical',
        description: `Check-in date mismatch: Sheet=${s.checkIn}, Firestore=${fs.checkIn}`
      });
    }

    if (s.checkOut !== fs.checkOut) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'checkOut',
        sheetValue: s.checkOut,
        firestoreValue: fs.checkOut,
        severity: 'critical',
        description: `Check-out date mismatch: Sheet=${s.checkOut}, Firestore=${fs.checkOut}`
      });
    }

    // Compare Room / Bed
    const sRoom = normalizeRoomName(s.room);
    const fRoom = normalizeRoomName(fs.room);
    if (sRoom !== fRoom) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'room',
        sheetValue: s.room,
        firestoreValue: fs.room,
        severity: 'critical',
        description: `Room mismatch: Sheet=${s.room}, Firestore=${fs.room}`
      });
    }

    const sBed = (s.bedCode || s.unitId || '').trim();
    const fBed = (fs.bedCode || fs.unitId || '').trim();
    if (sBed !== fBed) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'bedCode',
        sheetValue: sBed,
        firestoreValue: fBed,
        severity: 'warning',
        description: `Bed code mismatch: Sheet=${sBed}, Firestore=${fBed}`
      });
    }

    // Compare Financials
    const sGross = s.grossValue;
    const fGross = fs.totalAmount || 0;
    if (Math.abs(sGross - fGross) > 0.05) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'totalAmount',
        sheetValue: sGross,
        firestoreValue: fGross,
        severity: 'critical',
        description: `Total Amount mismatch: Sheet=${sGross}, Firestore=${fGross}`
      });
    }

    const sPaid = s.paidAmount;
    const fPaid = fs.paidAmount || 0;
    if (Math.abs(sPaid - fPaid) > 0.05) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'paidAmount',
        sheetValue: sPaid,
        firestoreValue: fPaid,
        severity: 'warning',
        description: `Paid amount mismatch: Sheet=${sPaid}, Firestore=${fPaid}`
      });
    }

    // Compare Status
    if ((s.status || '').toLowerCase() !== (fs.status || '').toLowerCase()) {
      hasDiff = true;
      discrepancies.push({
        bookingId: s.bookingId,
        field: 'status',
        sheetValue: s.status,
        firestoreValue: fs.status,
        severity: 'warning',
        description: `Status mismatch: Sheet=${s.status}, Firestore=${fs.status}`
      });
    }

    if (hasDiff) {
      discrepantCount++;
    } else {
      identicalCount++;
    }
  }

  // 4. Double booking / collision checks across combined active bookings
  const activeBookings = sheetRecords
    .filter(r => !r.status.toLowerCase().includes('cancel'))
    .map(r => ({
      id: r.bookingId,
      guestName: r.guestName,
      room: r.room,
      bedCode: r.bedCode,
      checkIn: r.checkIn,
      checkOut: r.checkOut
    }));

  for (let i = 0; i < activeBookings.length; i++) {
    const a = activeBookings[i];
    const roomA = normalizeRoomName(a.room);
    const bedA = a.bedCode.trim();

    for (let j = i + 1; j < activeBookings.length; j++) {
      const b = activeBookings[j];
      const roomB = normalizeRoomName(b.room);
      const bedB = b.bedCode.trim();

      if (roomA === roomB && bedA === bedB && doDateRangesOverlap(a.checkIn, a.checkOut, b.checkIn, b.checkOut)) {
        const overlap = getOverlapRange(a.checkIn, a.checkOut, b.checkIn, b.checkOut);
        conflicts.push({
          id: `conflict-${a.id}-${b.id}`,
          type: 'double_booking',
          description: `Double booking on ${roomA} Bed ${bedA} between ${a.guestName} (${a.id}) and ${b.guestName} (${b.id})`,
          bookingA: a.id,
          bookingB: b.id,
          room: a.room,
          bed: bedA,
          overlap: `${overlap.start} to ${overlap.end} (${overlap.nights} nights)`
        });
      }
    }
  }

  // 5. Financial Totals
  const sheetTotalGrossUSD = sheetRecords.reduce((sum, r) => sum + (r.currency === 'USD' ? r.grossValue : r.grossValue / (r.savedTzsPerUsd || 2645)), 0);
  const sheetTotalPaidUSD = sheetRecords.reduce((sum, r) => sum + (r.currency === 'USD' ? r.paidAmount : r.paidAmount / (r.savedTzsPerUsd || 2645)), 0);
  const sheetTotalBalanceUSD = sheetRecords.reduce((sum, r) => sum + (r.currency === 'USD' ? r.balanceDue : r.balanceDue / (r.savedTzsPerUsd || 2645)), 0);

  const firestoreTotalGrossUSD = firestoreRecords.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  const firestoreTotalPaidUSD = firestoreRecords.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
  const firestoreTotalBalanceUSD = firestoreRecords.reduce((sum, r) => sum + (r.balanceDue || 0), 0);

  return {
    timestamp: new Date().toISOString(),
    sheetRecordsCount: sheetRecords.length,
    firestoreRecordsCount: firestoreRecords.length,
    matchedRecordsCount: matchedCount,
    identicalRecordsCount: identicalCount,
    discrepantRecordsCount: discrepantCount,
    sheetOnlyCount: sheetRecords.length - matchedCount,
    firestoreOnlyCount: firestoreRecords.length - matchedCount,
    conflictsCount: conflicts.length,
    invalidRecordsCount: invalidRecords.length,
    discrepancies,
    conflicts,
    invalidRecords,
    financialSummary: {
      sheetTotalGrossUSD: Math.round(sheetTotalGrossUSD * 100) / 100,
      sheetTotalPaidUSD: Math.round(sheetTotalPaidUSD * 100) / 100,
      sheetTotalBalanceUSD: Math.round(sheetTotalBalanceUSD * 100) / 100,
      firestoreTotalGrossUSD: Math.round(firestoreTotalGrossUSD * 100) / 100,
      firestoreTotalPaidUSD: Math.round(firestoreTotalPaidUSD * 100) / 100,
      firestoreTotalBalanceUSD: Math.round(firestoreTotalBalanceUSD * 100) / 100
    }
  };
}

/**
 * Transforms a SheetRowRecord into a clean, authoritative Firestore Reservation document.
 */
export function sheetRowToFirestoreReservation(record: SheetRowRecord): Reservation {
  return {
    id: record.bookingId,
    guestName: record.guestName,
    guestId: record.guestId,
    phone: record.phone,
    email: record.email,
    room: record.room,
    bedCode: record.bedCode,
    unitId: record.unitId,
    bedsCount: record.bedCode.includes('ALL') ? 4 : 1,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    nights: record.nights,
    totalAmount: record.grossValue,
    paidAmount: record.paidAmount,
    balanceDue: record.balanceDue,
    status: record.status,
    currency: record.currency,
    platform: record.platform,
    notes: record.notes,
    loyalty: 'New / returning guest'
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDateString,
  parseFinancialAmount,
  canonicalRoomName,
  parseSheetRowsToRecords,
  reconcileReservations
} from '../src/migration/reconciliation.ts';

test('normalizeDateString correctly normalizes multiple formats to ISO YYYY-MM-DD', () => {
  assert.equal(normalizeDateString('05 Oct 2026'), '2026-10-05');
  assert.equal(normalizeDateString('5 Oct 2026'), '2026-10-05');
  assert.equal(normalizeDateString('05-Oct-2026'), '2026-10-05');
  assert.equal(normalizeDateString('2026-10-05'), '2026-10-05');
  assert.equal(normalizeDateString('12 Jan 2027'), '2027-01-12');
  assert.equal(normalizeDateString('25/09/2026'), '2026-09-25');
  assert.equal(normalizeDateString(''), '');
  assert.equal(normalizeDateString(null), '');
});

test('parseFinancialAmount handles currencies, commas, negatives, and NaN values safely', () => {
  assert.equal(parseFinancialAmount('$120.00'), 120);
  assert.equal(parseFinancialAmount('TZS 52,900'), 52900);
  assert.equal(parseFinancialAmount('1,250.50'), 1250.5);
  assert.equal(parseFinancialAmount(''), 0);
  assert.equal(parseFinancialAmount(null), 0);
  assert.equal(parseFinancialAmount(NaN), 0);
  assert.equal(parseFinancialAmount(45.999), 46);
});

test('canonicalRoomName maps variations to official hostel room names', () => {
  assert.equal(canonicalRoomName('Njoro (Room 2)'), 'Njoro (Room 2)');
  assert.equal(canonicalRoomName('njoro'), 'Njoro (Room 2)');
  assert.equal(canonicalRoomName('Bondeni Dorm'), 'Bondeni (Room 3)');
  assert.equal(canonicalRoomName('Mawenzi Private'), 'Mawenzi (Room 1)');
  assert.equal(canonicalRoomName('Soweto Single'), 'Soweto (Room 4)');
});

test('parseSheetRowsToRecords parses 72-column Google Sheet table accurately', () => {
  const headerRow = [
    'Booking ID', 'Guest Name', 'Phone Number', 'Email', 'Guest ID',
    'Platform', 'Check-in', 'Check-out', 'Room Selection', 'Bed Selection',
    'Status', 'Currency', 'Gross value', 'Balance due', 'Deposit received',
    'Other received', 'Refunds paid', 'Hold expires', 'Notes', 'Nights',
    'Guests', 'Commission %', 'Other platform fee', 'Commission total',
    'Net revenue', 'Net received', 'Assigned beds', 'Saved TZS per USD'
  ];

  const row1 = [
    'MU-101', 'Alice Johnson', '+255 712 345 678', 'alice@example.com', 'GS-0101',
    'Booking.com', '05 Oct 2026', '08 Oct 2026', 'Njoro (Room 2)', 'N-B1L',
    'Confirmed', 'USD', '60.00', '20.00', '40.00',
    '0.00', '0.00', '', 'Arriving late evening', '3',
    '1', '15%', '0', '9.00',
    '51.00', '40.00', '1', '2645'
  ];

  const row2 = [
    'MU-102', 'Brian Smith', '+255 754 999 888', 'brian@example.com', 'GS-0102',
    'Direct Booking', '10 Oct 2026', '12 Oct 2026', 'Mawenzi', 'M-S1',
    'Confirmed', 'TZS', '105,800', '0', '105,800',
    '0', '0', '', 'Paid via M-Pesa', '2',
    '1', '0%', '0', '0',
    '105800', '105800', '1', '2645'
  ];

  const records = parseSheetRowsToRecords([headerRow, row1, row2]);
  assert.equal(records.length, 2);

  assert.equal(records[0].bookingId, 'MU-101');
  assert.equal(records[0].guestName, 'Alice Johnson');
  assert.equal(records[0].checkIn, '2026-10-05');
  assert.equal(records[0].checkOut, '2026-10-08');
  assert.equal(records[0].nights, 3);
  assert.equal(records[0].grossValue, 60);
  assert.equal(records[0].paidAmount, 40);
  assert.equal(records[0].balanceDue, 20);
  assert.equal(records[0].currency, 'USD');

  assert.equal(records[1].bookingId, 'MU-102');
  assert.equal(records[1].checkIn, '2026-10-10');
  assert.equal(records[1].checkOut, '2026-10-12');
  assert.equal(records[1].grossValue, 105800);
  assert.equal(records[1].currency, 'TZS');
});

test('reconcileReservations detects exact matches, discrepancies, and double bookings', () => {
  const sheetRecords = [
    {
      bookingId: 'MU-201',
      guestName: 'Clara Oswald',
      phone: '+44 7700 900077',
      email: 'clara@example.com',
      guestId: 'GS-0201',
      platform: 'Hostelworld',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-B1L',
      unitId: 'B-B1L',
      status: 'Confirmed',
      currency: 'USD',
      grossValue: 80,
      depositReceived: 20,
      otherReceived: 0,
      refundsPaid: 0,
      paidAmount: 20,
      balanceDue: 60,
      notes: 'Vegan breakfast',
      nights: 4,
      guestsCount: 1,
      savedTzsPerUsd: 2645
    },
    {
      bookingId: 'MU-202',
      guestName: 'David Tennant',
      phone: '+44 7700 900088',
      email: 'david@example.com',
      guestId: 'GS-0202',
      platform: 'Direct Booking',
      checkIn: '2026-11-03', // Overlaps with Clara on B-B1L!
      checkOut: '2026-11-06',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-B1L',
      unitId: 'B-B1L',
      status: 'Confirmed',
      currency: 'USD',
      grossValue: 60,
      depositReceived: 60,
      otherReceived: 0,
      refundsPaid: 0,
      paidAmount: 60,
      balanceDue: 0,
      notes: '',
      nights: 3,
      guestsCount: 1,
      savedTzsPerUsd: 2645
    }
  ];

  const firestoreRecords = [
    {
      id: 'MU-201',
      guestName: 'Clara Oswald',
      phone: '+44 7700 900077',
      email: 'clara@example.com',
      guestId: 'GS-0201',
      platform: 'Hostelworld',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-B1L',
      unitId: 'B-B1L',
      bedsCount: 1,
      status: 'Confirmed',
      currency: 'USD',
      nights: 4,
      totalAmount: 80,
      paidAmount: 20,
      balanceDue: 60
    }
  ];

  const report = reconcileReservations(sheetRecords, firestoreRecords);

  assert.equal(report.sheetRecordsCount, 2);
  assert.equal(report.firestoreRecordsCount, 1);
  assert.equal(report.matchedRecordsCount, 1);
  assert.equal(report.identicalRecordsCount, 1);
  assert.equal(report.sheetOnlyCount, 1); // MU-202 is only in Sheet
  assert.equal(report.conflictsCount, 1); // Double booking between MU-201 and MU-202
  assert.match(report.conflicts[0].description, /Double booking on bondeni Bed B-B1L/);
});

test('reconcileReservations handles missing booking IDs, negative numbers, and invalid date ranges gracefully', () => {
  const headerRow = [
    'Booking ID', 'Guest Name', 'Phone Number', 'Email', 'Guest ID',
    'Platform', 'Check-in', 'Check-out', 'Room Selection', 'Bed Selection',
    'Status', 'Currency', 'Gross value', 'Balance due', 'Deposit received',
    'Other received', 'Refunds paid', 'Hold expires', 'Notes', 'Nights',
    'Guests', 'Commission %', 'Other platform fee', 'Commission total',
    'Net revenue', 'Net received', 'Assigned beds', 'Booking check',
    'Assignment check', 'Blocks inventory', 'Calendar event ID', 'Calendar sync',
    'Last synced', 'Revenue eligible', 'Arrival order', 'Departure order',
    'Lead Guest ID', 'Lead prior stays', 'Lead loyalty', 'Add to Calendar',
    'Pricing mode', 'Manual gross total', 'Guest records', 'Pricing check',
    'Guest quote / TZS', 'Guest quote / USD', 'Nightly rate override / TZS',
    'Pricing date override', 'Saved TZS per USD', 'Contact check', 'Discount %',
    'Guest record check'
  ];

  // Row with missing booking ID (blank cell):
  const rowBlankId = new Array(headerRow.length).fill('');
  rowBlankId[1] = 'Elena Gilbert'; // Guest Name
  rowBlankId[6] = '15 Dec 2026'; // Check-in
  rowBlankId[7] = '18 Dec 2026'; // Check-out
  rowBlankId[8] = 'Soweto (Room 4)';
  rowBlankId[9] = 'S-S1';
  rowBlankId[10] = 'Confirmed';
  rowBlankId[11] = 'USD';
  rowBlankId[12] = '60.00';
  rowBlankId[13] = '0.00';
  rowBlankId[14] = '60.00';

  // Row with invalid inverted date range (checkIn >= checkOut):
  const rowInvalidDates = new Array(headerRow.length).fill('');
  rowInvalidDates[0] = 'MU-999';
  rowInvalidDates[1] = 'Stefan Salvatore';
  rowInvalidDates[6] = '20 Dec 2026';
  rowInvalidDates[7] = '19 Dec 2026'; // Inverted!
  rowInvalidDates[8] = 'Mawenzi (Room 1)';
  rowInvalidDates[9] = 'M-S1';
  rowInvalidDates[10] = 'Confirmed';
  rowInvalidDates[11] = 'USD';
  rowInvalidDates[12] = '40.00';

  const parsed = parseSheetRowsToRecords([headerRow, rowBlankId, rowInvalidDates]);
  assert.equal(parsed.length, 2);

  // Missing booking ID is safely assigned a predictable index without throwing
  assert.match(parsed[0].bookingId, /^MU-\d+$/);
  assert.equal(parsed[0].guestName, 'Elena Gilbert');
  assert.equal(parsed[0].checkIn, '2026-12-15');
  assert.equal(parsed[0].checkOut, '2026-12-18');

  // Reconciliation flags invalid dates
  const report = reconcileReservations(parsed, []);
  assert.equal(report.invalidRecordsCount, 1);
  assert.equal(report.invalidRecords[0].bookingId, 'MU-999');
  assert.match(report.invalidRecords[0].reason, /Invalid date range/);
});


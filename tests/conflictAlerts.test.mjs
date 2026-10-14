import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doDateRangesOverlap,
  getOverlapRange,
  detectBookingConflicts,
  checkNewBookingConflict
} from '../src/bookingConflicts.ts';

test('doDateRangesOverlap correctly checks boundaries', () => {
  // Oct 10 to Oct 13 vs Oct 12 to Oct 15 -> Overlap on Oct 12
  assert.equal(doDateRangesOverlap('2026-10-10', '2026-10-13', '2026-10-12', '2026-10-15'), true);

  // Same day turnover: Oct 10 to Oct 13 vs Oct 13 to Oct 16 -> NO overlap
  assert.equal(doDateRangesOverlap('2026-10-10', '2026-10-13', '2026-10-13', '2026-10-16'), false);

  // Completely separate dates
  assert.equal(doDateRangesOverlap('2026-10-01', '2026-10-05', '2026-10-10', '2026-10-15'), false);
});

test('detectBookingConflicts catches double booking on same bed', () => {
  const reservations = [
    {
      id: 'MU-101',
      guestName: 'Guest One',
      room: 'Njoro (Room 2)',
      bedCode: 'N-B1L',
      unitId: 'N-B1L',
      checkIn: '2026-10-10',
      checkOut: '2026-10-14',
      status: 'Confirmed'
    },
    {
      id: 'MU-102',
      guestName: 'Guest Two',
      room: 'Njoro (Room 2)',
      bedCode: 'N-B1L',
      unitId: 'N-B1L',
      checkIn: '2026-10-12',
      checkOut: '2026-10-16',
      status: 'Confirmed'
    }
  ];

  const conflicts = detectBookingConflicts(reservations);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'double_booking');
  assert.equal(conflicts[0].bedCode, 'N-B1L');
  assert.equal(conflicts[0].overlappingNights, 2);
  assert.equal(conflicts[0].overlapStart, '2026-10-12');
  assert.equal(conflicts[0].overlapEnd, '2026-10-14');
});

test('detectBookingConflicts catches whole-room collision', () => {
  const reservations = [
    {
      id: 'MU-201',
      guestName: 'Whole Group',
      room: 'Mawenzi (Room 1)',
      bedCode: 'M-ALL',
      unitId: 'M-ALL',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      status: 'Confirmed'
    },
    {
      id: 'MU-202',
      guestName: 'Single Solo Guest',
      room: 'Mawenzi (Room 1)',
      bedCode: 'M-S1',
      unitId: 'M-S1',
      checkIn: '2026-11-03',
      checkOut: '2026-11-04',
      status: 'Confirmed'
    }
  ];

  const conflicts = detectBookingConflicts(reservations);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'whole_room_collision');
});

test('detectBookingConflicts ignores cancelled bookings', () => {
  const reservations = [
    {
      id: 'MU-301',
      guestName: 'Active Guest',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-B1L',
      unitId: 'B-B1L',
      checkIn: '2026-10-20',
      checkOut: '2026-10-25',
      status: 'Confirmed'
    },
    {
      id: 'MU-302',
      guestName: 'Cancelled Guest',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-B1L',
      unitId: 'B-B1L',
      checkIn: '2026-10-20',
      checkOut: '2026-10-25',
      status: 'Cancelled'
    }
  ];

  const conflicts = detectBookingConflicts(reservations);
  assert.equal(conflicts.length, 0);
});

test('checkNewBookingConflict warns before adding a clashing reservation', () => {
  const existing = [
    {
      id: 'MU-401',
      guestName: 'Existing Guest',
      room: 'Soweto (Room 4)',
      bedCode: 'S-S1',
      unitId: 'S-S1',
      checkIn: '2026-12-01',
      checkOut: '2026-12-05',
      status: 'Confirmed'
    }
  ];

  const conflict = checkNewBookingConflict(
    {
      room: 'Soweto (Room 4)',
      bedCode: 'S-S1',
      checkIn: '2026-12-03',
      checkOut: '2026-12-07',
      guestName: 'New Applicant'
    },
    existing
  );

  assert.ok(conflict);
  assert.equal(conflict.type, 'double_booking');
  assert.equal(conflict.overlappingNights, 2);

  // When excluding self when editing, it should return null
  const noSelfConflict = checkNewBookingConflict(
    {
      id: 'MU-401',
      room: 'Soweto (Room 4)',
      bedCode: 'S-S1',
      checkIn: '2026-12-01',
      checkOut: '2026-12-05',
      guestName: 'Existing Guest'
    },
    existing,
    'MU-401'
  );

  assert.equal(noSelfConflict, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  doDateRangesOverlap,
  getOverlapRange,
  detectBookingConflicts,
  checkNewBookingConflict,
  normalizeRoomName
} from '../src/bookingConflicts.ts';

test('Double booking prevention: checkout day turnover is allowed', () => {
  // Guest 1: Oct 1 - Oct 5 (leaves on Oct 5)
  // Guest 2: Oct 5 - Oct 8 (arrives on Oct 5)
  // Same bed, should NOT conflict!
  const overlap = doDateRangesOverlap('2026-10-01', '2026-10-05', '2026-10-05', '2026-10-08');
  assert.equal(overlap, false, 'Turnover day must not be considered an overlap');
});

test('Double booking prevention: overlapping stay on same bed triggers conflict', () => {
  // Guest 1: Oct 1 - Oct 5
  // Guest 2: Oct 4 - Oct 7 (overlaps on night of Oct 4)
  const overlap = doDateRangesOverlap('2026-10-01', '2026-10-05', '2026-10-04', '2026-10-07');
  assert.equal(overlap, true);

  const range = getOverlapRange('2026-10-01', '2026-10-05', '2026-10-04', '2026-10-07');
  assert.equal(range.start, '2026-10-04');
  assert.equal(range.end, '2026-10-05');
  assert.equal(range.nights, 1);
});

test('Double booking prevention: whole room reservation blocks individual bed reservations', () => {
  const existingBookings = [
    {
      id: 'MU-1',
      guestName: 'Tour Group',
      room: 'Bondeni (Room 3)',
      bedCode: 'B-ALL',
      unitId: 'B-ALL',
      checkIn: '2026-11-10',
      checkOut: '2026-11-15',
      status: 'Confirmed'
    }
  ];

  // Prospective guest tries to book B-B1L during tour group stay
  const candidate = {
    guestName: 'Solo Backpacker',
    room: 'Bondeni (Room 3)',
    bedCode: 'B-B1L',
    checkIn: '2026-11-12',
    checkOut: '2026-11-14'
  };

  const conflict = checkNewBookingConflict(candidate, existingBookings);
  assert.notEqual(conflict, null);
  assert.equal(conflict.type, 'whole_room_collision');
  assert.match(conflict.description, /already booked the entire room/);
});

test('Double booking prevention: individual bed blocks whole room reservation', () => {
  const existingBookings = [
    {
      id: 'MU-2',
      guestName: 'Solo Backpacker',
      room: 'Njoro (Room 2)',
      bedCode: 'N-B1L',
      unitId: 'N-B1L',
      checkIn: '2026-12-01',
      checkOut: '2026-12-05',
      status: 'Confirmed'
    }
  ];

  // Prospective guest tries to book N-ALL during solo backpacker stay
  const candidate = {
    guestName: 'School Group',
    room: 'Njoro (Room 2)',
    bedCode: 'N-ALL',
    checkIn: '2026-12-02',
    checkOut: '2026-12-04'
  };

  const conflict = checkNewBookingConflict(candidate, existingBookings);
  assert.notEqual(conflict, null);
  assert.equal(conflict.type, 'whole_room_collision');
  assert.match(conflict.description, /Bed N-B1L is already booked/);
});

test('Double booking prevention: cancelled reservation does not block bed inventory', () => {
  const existingBookings = [
    {
      id: 'MU-3',
      guestName: 'Cancelled Guest',
      room: 'Mawenzi (Room 1)',
      bedCode: 'M-S1',
      unitId: 'M-S1',
      checkIn: '2026-10-20',
      checkOut: '2026-10-25',
      status: 'Cancelled' // Cancelled!
    }
  ];

  const candidate = {
    guestName: 'New Guest',
    room: 'Mawenzi (Room 1)',
    bedCode: 'M-S1',
    checkIn: '2026-10-20',
    checkOut: '2026-10-25'
  };

  const conflict = checkNewBookingConflict(candidate, existingBookings);
  assert.equal(conflict, null, 'Cancelled bookings must release bed inventory');
});

test('Simultaneous booking contention: only first write succeeds, conflicting write is rejected', () => {
  const state = [];

  const simulateTransactionalBooking = (candidate) => {
    // Check conflicts against committed state
    const conflict = checkNewBookingConflict(candidate, state);
    if (conflict) {
      throw new Error(`Double booking prevented: ${conflict.description}`);
    }
    // Commit to state
    state.push({ ...candidate, status: 'Confirmed' });
    return { success: true, bookingId: candidate.id };
  };

  const bookingA = {
    id: 'TX-1',
    guestName: 'Guest One',
    room: 'Soweto (Room 4)',
    bedCode: 'S-S1',
    checkIn: '2026-11-20',
    checkOut: '2026-11-24'
  };

  const bookingB = {
    id: 'TX-2',
    guestName: 'Guest Two',
    room: 'Soweto (Room 4)',
    bedCode: 'S-S1',
    checkIn: '2026-11-22',
    checkOut: '2026-11-26'
  };

  // Transaction A completes first:
  const resA = simulateTransactionalBooking(bookingA);
  assert.equal(resA.success, true);
  assert.equal(state.length, 1);

  // Transaction B arrives second and targets same bed on overlapping dates:
  assert.throws(
    () => simulateTransactionalBooking(bookingB),
    /Double booking prevented/
  );
  assert.equal(state.length, 1, 'Rejected booking must not be committed');
});

test('Transactional Bed Reallocation: Moving reservation to a new bed releases old bed and reserves new bed', () => {
  // Simulate transactional inventory foot-printing
  const bedSchedules = new Map();

  const allocateBedTransaction = (res, previousRes = null) => {
    const nights = [];
    const cur = new Date(res.checkIn);
    const end = new Date(res.checkOut);
    while (cur < end) {
      nights.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    // Read phase: check for conflict on new bed
    const newBedSched = bedSchedules.get(res.bedCode) || {};
    for (const night of nights) {
      const alloc = newBedSched[night];
      if (alloc && alloc.reservationId !== res.id) {
        throw new Error(`Double-booking prevented on bed ${res.bedCode}`);
      }
    }

    // Write phase: clean up previous bed if reallocated
    if (previousRes && previousRes.bedCode !== res.bedCode) {
      const oldSched = bedSchedules.get(previousRes.bedCode) || {};
      for (const [dKey, alloc] of Object.entries(oldSched)) {
        if (alloc.reservationId === res.id) {
          delete oldSched[dKey];
        }
      }
      bedSchedules.set(previousRes.bedCode, oldSched);
    }

    // Reserve new bed
    for (const night of nights) {
      newBedSched[night] = { reservationId: res.id, guestName: res.guestName };
    }
    bedSchedules.set(res.bedCode, newBedSched);
    return true;
  };

  // 1. Guest A books Bed B-B1L from 2026-11-01 to 2026-11-05
  const guestA = {
    id: 'MU-MOVE-1',
    guestName: 'Traveler One',
    bedCode: 'B-B1L',
    checkIn: '2026-11-01',
    checkOut: '2026-11-05'
  };
  allocateBedTransaction(guestA);

  // 2. Guest B tries to book Bed B-B1L for same dates -> rejected!
  assert.throws(
    () => allocateBedTransaction({ id: 'MU-MOVE-2', guestName: 'Traveler Two', bedCode: 'B-B1L', checkIn: '2026-11-02', checkOut: '2026-11-04' }),
    /Double-booking prevented/
  );

  // 3. Receptionist moves Guest A from Bed B-B1L to Bed B-B2L
  const movedGuestA = { ...guestA, bedCode: 'B-B2L' };
  allocateBedTransaction(movedGuestA, guestA);

  // 4. Now Bed B-B1L is released! Guest B can now successfully book Bed B-B1L!
  const guestBSuccess = allocateBedTransaction({
    id: 'MU-MOVE-2',
    guestName: 'Traveler Two',
    bedCode: 'B-B1L',
    checkIn: '2026-11-02',
    checkOut: '2026-11-04'
  });
  assert.equal(guestBSuccess, true, 'Old bed must be released when reservation is reallocated');

  // 5. Meanwhile, new Bed B-B2L is protected by Guest A
  assert.throws(
    () => allocateBedTransaction({ id: 'MU-MOVE-3', guestName: 'Traveler Three', bedCode: 'B-B2L', checkIn: '2026-11-03', checkOut: '2026-11-04' }),
    /Double-booking prevented/
  );
});

test('Transactional Inventory Release: Deleting reservation releases all occupied nights immediately', () => {
  const bedSchedule = {
    '2026-12-10': { reservationId: 'MU-DEL-1', guestName: 'Guest' },
    '2026-12-11': { reservationId: 'MU-DEL-1', guestName: 'Guest' }
  };

  // Deletion releases allocations
  for (const [night, alloc] of Object.entries(bedSchedule)) {
    if (alloc.reservationId === 'MU-DEL-1') {
      delete bedSchedule[night];
    }
  }

  assert.equal(Object.keys(bedSchedule).length, 0, 'All dates must be freed upon deletion');
});

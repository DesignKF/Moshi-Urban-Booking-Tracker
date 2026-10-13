import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateKey,
  parseDateKey,
  calculateInventory,
  isReservationActiveOnDate,
  calculateDateAvailability,
  generateMonthGrid,
  formatReadableHeading,
  deriveSyncStatus
} from '../src/calendarUxLogic.mjs';

const mockRooms = [
  { id: 'njoro', name: 'Njoro', roomCode: 'Room 2', capacity: 6 },
  { id: 'bondeni', name: 'Bondeni', roomCode: 'Room 3', capacity: 4 },
  { id: 'mawenzi', name: 'Mawenzi', roomCode: 'Room 1', capacity: 3 },
  { id: 'soweto', name: 'Soweto', roomCode: 'Room 4', capacity: 3 }
];

test('calculateInventory dynamically sums rooms and beds without hardcoding 16', () => {
  const inv = calculateInventory(mockRooms);
  assert.equal(inv.totalRooms, 4);
  assert.equal(inv.totalBeds, 16);

  // Test with custom inventory
  const customRooms = [
    { id: 'r1', name: 'Deluxe', capacity: 2 },
    { id: 'r2', name: 'Suite', capacity: 5 }
  ];
  const customInv = calculateInventory(customRooms);
  assert.equal(customInv.totalRooms, 2);
  assert.equal(customInv.totalBeds, 7);
});

test('availability calculation on empty date shows 100% free and zero booked', () => {
  const date = '2026-10-15';
  const avail = calculateDateAvailability(date, [], mockRooms);

  assert.equal(avail.totalRooms, 4);
  assert.equal(avail.totalBeds, 16);
  assert.equal(avail.availableBedsCount, 16);
  assert.equal(avail.occupiedBedsCount, 0);
  assert.equal(avail.bookedRoomsCount, 0);
  assert.equal(avail.availableRoomsCount, 4);
  assert.equal(avail.hasBookings, false);
  assert.equal(avail.isFull, false);
  assert.equal(avail.reservationCount, 0);
});

test('multi-night stay and checkout boundary: checkout date is NOT occupied', () => {
  const reservations = [
    {
      id: 'MU-101',
      guestName: 'Jane Doe',
      room: 'Njoro (Room 2)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-13',
      bedsCount: 1,
      status: 'Confirmed'
    }
  ];

  // Night 1: Oct 10 -> active
  const oct10 = calculateDateAvailability('2026-10-10', reservations, mockRooms);
  assert.equal(oct10.occupiedBedsCount, 1);
  assert.equal(oct10.availableBedsCount, 15);
  assert.equal(oct10.bookedRoomsCount, 1);

  // Night 2: Oct 11 -> active
  const oct11 = calculateDateAvailability('2026-10-11', reservations, mockRooms);
  assert.equal(oct11.occupiedBedsCount, 1);
  assert.equal(oct11.availableBedsCount, 15);

  // Night 3: Oct 12 -> active
  const oct12 = calculateDateAvailability('2026-10-12', reservations, mockRooms);
  assert.equal(oct12.occupiedBedsCount, 1);
  assert.equal(oct12.availableBedsCount, 15);

  // Checkout date: Oct 13 -> NOT occupied! Free for next guest
  const oct13 = calculateDateAvailability('2026-10-13', reservations, mockRooms);
  assert.equal(oct13.occupiedBedsCount, 0);
  assert.equal(oct13.availableBedsCount, 16);
  assert.equal(oct13.bookedRoomsCount, 0);
  assert.equal(oct13.departures.length, 1);
});

test('cancelled bookings are ignored from occupancy', () => {
  const reservations = [
    {
      id: 'MU-CANCELLED',
      guestName: 'Ghost Guest',
      room: 'Njoro (Room 2)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      bedsCount: 2,
      status: 'Cancelled'
    }
  ];
  const avail = calculateDateAvailability('2026-10-12', reservations, mockRooms);
  assert.equal(avail.occupiedBedsCount, 0);
  assert.equal(avail.availableBedsCount, 16);
  assert.equal(avail.hasBookings, false);
});

test('tentative bookings ARE counted towards occupancy to prevent double bookings', () => {
  const reservations = [
    {
      id: 'MU-TENTATIVE',
      guestName: 'Prospective Guest',
      room: 'Bondeni (Room 3)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      bedsCount: 2,
      status: 'Tentative'
    }
  ];
  const avail = calculateDateAvailability('2026-10-12', reservations, mockRooms);
  assert.equal(avail.occupiedBedsCount, 2);
  assert.equal(avail.availableBedsCount, 14);
  assert.equal(avail.bookedRoomsCount, 1);
  assert.equal(avail.hasBookings, true);
});

test('distinguishes booked rooms count from reservation count (multi-bed vs multiple reservations)', () => {
  // Scenario A: 2 separate reservations in the SAME room (Njoro)
  const twoBookingsOneRoom = [
    {
      id: 'MU-1',
      guestName: 'Guest 1',
      room: 'Njoro (Room 2)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      bedsCount: 1,
      status: 'Confirmed'
    },
    {
      id: 'MU-2',
      guestName: 'Guest 2',
      room: 'Njoro (Room 2)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      bedsCount: 1,
      status: 'Checked-in'
    }
  ];
  const availA = calculateDateAvailability('2026-10-11', twoBookingsOneRoom, mockRooms);
  assert.equal(availA.reservationCount, 2); // 2 reservations
  assert.equal(availA.occupiedBedsCount, 2); // 2 beds
  assert.equal(availA.bookedRoomsCount, 1); // but only 1 room is booked!

  // Scenario B: 1 reservation booking 4 beds across Bondeni
  const wholeRoom = [
    {
      id: 'MU-WHOLE',
      guestName: 'Group Lead',
      room: 'Bondeni (Room 3)',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      bedsCount: 4,
      status: 'Confirmed'
    }
  ];
  const availB = calculateDateAvailability('2026-10-11', wholeRoom, mockRooms);
  assert.equal(availB.reservationCount, 1); // 1 reservation
  assert.equal(availB.occupiedBedsCount, 4); // 4 beds
  assert.equal(availB.bookedRoomsCount, 1); // 1 room
  assert.equal(availB.fullyBookedRoomsCount, 1); // Bondeni is fully booked!
});

test('full occupancy is accurately reported as 0 free and isFull = true', () => {
  const fullHouse = [
    { id: '1', room: 'Njoro', checkIn: '2026-10-01', checkOut: '2026-10-05', bedsCount: 6, status: 'Confirmed' },
    { id: '2', room: 'Bondeni', checkIn: '2026-10-01', checkOut: '2026-10-05', bedsCount: 4, status: 'Confirmed' },
    { id: '3', room: 'Mawenzi', checkIn: '2026-10-01', checkOut: '2026-10-05', bedsCount: 3, status: 'Confirmed' },
    { id: '4', room: 'Soweto', checkIn: '2026-10-01', checkOut: '2026-10-05', bedsCount: 3, status: 'Confirmed' }
  ];
  const avail = calculateDateAvailability('2026-10-03', fullHouse, mockRooms);
  assert.equal(avail.availableBedsCount, 0);
  assert.equal(avail.occupiedBedsCount, 16);
  assert.equal(avail.bookedRoomsCount, 4);
  assert.equal(avail.availableRoomsCount, 0);
  assert.equal(avail.isFull, true);
});

test('generateMonthGrid generates 35 or 42 cells with correct labels', () => {
  // October 2026 (starts on Thursday, 31 days)
  const todayStr = '2026-10-14';
  const grid = generateMonthGrid(2026, 9, [], mockRooms, todayStr);

  assert.ok(grid.cells.length === 35 || grid.cells.length === 42);
  const todayCell = grid.cells.find(c => c.dateStr === todayStr);
  assert.ok(todayCell);
  assert.equal(todayCell.isToday, true);
  assert.equal(todayCell.shortAvailabilityLabel, '16 free');
  assert.equal(todayCell.compactBookedLabel, ''); // No booking indicator when no bookings!
  assert.equal(todayCell.hasBookings, false);
});

test('calendar availability consistently reflects beds and does not confuse rooms with beds', () => {
  const sampleBookings = [
    { id: 'b1', room: 'Njoro', checkIn: '2026-10-10', checkOut: '2026-10-15', bedsCount: 1, status: 'Confirmed' },
    { id: 'b2', room: 'Bondeni', checkIn: '2026-10-12', checkOut: '2026-10-14', bedsCount: 2, status: 'Confirmed' }
  ];
  const avail = calculateDateAvailability('2026-10-13', sampleBookings, mockRooms);
  // Total beds = 16, occupied = 3, available beds = 13
  assert.equal(avail.totalBeds, 16);
  assert.equal(avail.occupiedBedsCount, 3);
  assert.equal(avail.availableBedsCount, 13);
  // Rooms with bookings = 2, total rooms = 4
  assert.equal(avail.totalRooms, 4);
  assert.equal(avail.bookedRoomsCount, 2);
  assert.equal(avail.reservationCount, 2);
});

test('deriveSyncStatus: correctly prioritizes offline over other states', () => {
  const status = deriveSyncStatus({
    isOffline: true,
    inFlightSaves: 2,
    lastSuccessfulRefreshTime: '10:00 AM'
  });
  assert.equal(status.state, 'offline');
  assert.equal(status.canSave, false);
});

test('deriveSyncStatus: multiple in-flight operations show saving and do not show saved until all finish', () => {
  // 2 in flight
  const status2 = deriveSyncStatus({ inFlightSaves: 2 });
  assert.equal(status2.state, 'saving');
  assert.equal(status2.label, 'Saving (2)...');

  // 1 finishes, 1 remaining
  const status1 = deriveSyncStatus({ inFlightSaves: 1 });
  assert.equal(status1.state, 'saving');
  assert.equal(status1.label, 'Saving...');

  // all finish, justSaved = true
  const statusSaved = deriveSyncStatus({ inFlightSaves: 0, justSaved: true, lastSuccessfulRefreshTime: '10:05 AM' });
  assert.equal(statusSaved.state, 'saved');
  assert.equal(statusSaved.label, 'Saved');
});

test('deriveSyncStatus: save succeeded but refresh failed is distinguished and not retried', () => {
  const status = deriveSyncStatus({
    saveSucceededRefreshFailed: true,
    lastSuccessfulRefreshTime: '09:30 AM'
  });
  assert.equal(status.state, 'sync_failed');
  assert.equal(status.label, 'Saved · Refresh Failed');
  assert.ok(status.description.includes('saved to the server'));
});

test('deriveSyncStatus: auth error is distinct from network error and blocks saving', () => {
  const status = deriveSyncStatus({
    lastError: { type: 'auth', message: 'Token expired' }
  });
  assert.equal(status.state, 'sync_failed');
  assert.equal(status.isAuthError, true);
  assert.equal(status.canSave, false);
});


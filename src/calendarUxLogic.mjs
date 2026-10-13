/**
 * Calendar UX & Availability Engine
 * Moshi Urban Hostel Management System
 * 
 * Rules:
 * - Dynamic room and bed inventory calculation (never hardcoded to 16).
 * - Occupied nights rule: checkIn <= dateStr < checkOut (checkout date is NOT an occupied night).
 * - Cancelled reservations are excluded from occupancy.
 * - Tentative reservations count towards occupancy to avoid double-bookings.
 * - Distinguishes booked rooms from total reservations count and occupied beds count.
 */

/**
 * Format year, month (0-indexed), and day into YYYY-MM-DD local string without timezone skew.
 */
export function formatDateKey(year, monthZeroIndexed, day) {
  const y = String(year);
  const m = String(monthZeroIndexed + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse YYYY-MM-DD into year, month (0-indexed), and day numbers.
 */
export function parseDateKey(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return { year, month, day };
}

/**
 * Calculate dynamic capacity from room inventory.
 */
export function calculateInventory(rooms = []) {
  const totalRooms = Array.isArray(rooms) ? rooms.length : 0;
  const totalBeds = Array.isArray(rooms)
    ? rooms.reduce((sum, r) => sum + (Number(r.capacity) || 0), 0)
    : 0;
  return { totalRooms, totalBeds };
}

/**
 * Check if a reservation is active on a given dateStr.
 * Occupied night rule: dateStr >= checkIn && dateStr < checkOut.
 * Cancelled bookings are ignored.
 */
export function isReservationActiveOnDate(reservation, dateStr) {
  if (!reservation || !dateStr) return false;
  const status = (reservation.status || '').toLowerCase().trim();
  if (status === 'cancelled') return false;

  const checkIn = reservation.checkIn;
  const checkOut = reservation.checkOut;
  if (!checkIn || !checkOut) return false;

  return dateStr >= checkIn && dateStr < checkOut;
}

/**
 * Calculate full availability breakdown for a single date.
 */
export function calculateDateAvailability(dateStr, reservations = [], rooms = []) {
  const inventory = calculateInventory(rooms);
  const totalRooms = inventory.totalRooms;
  const totalBeds = inventory.totalBeds;

  const activeBookings = (reservations || []).filter(r => isReservationActiveOnDate(r, dateStr));
  const arrivals = (reservations || []).filter(
    r => (r.status || '').toLowerCase() !== 'cancelled' && r.checkIn === dateStr
  );
  const departures = (reservations || []).filter(
    r => (r.status || '').toLowerCase() !== 'cancelled' && r.checkOut === dateStr
  );

  const occupiedBedsCount = activeBookings.reduce(
    (sum, r) => sum + (Number(r.bedsCount) || 1),
    0
  );
  const availableBedsCount = Math.max(0, totalBeds - occupiedBedsCount);

  // Room-by-room breakdown
  const roomBreakdown = (rooms || []).map(room => {
    const roomCapacity = Number(room.capacity) || 0;
    const roomName = (room.name || '').toLowerCase();
    const bookingsInRoom = activeBookings.filter(b => {
      const bRoom = (b.room || '').toLowerCase();
      return bRoom.includes(roomName);
    });
    const occupiedInRoom = bookingsInRoom.reduce(
      (sum, b) => sum + (Number(b.bedsCount) || 1),
      0
    );
    const freeInRoom = Math.max(0, roomCapacity - occupiedInRoom);
    const isBooked = bookingsInRoom.length > 0;
    const isFullyBooked = occupiedInRoom >= roomCapacity;

    return {
      roomId: room.id,
      roomName: room.name,
      roomCode: room.roomCode,
      capacity: roomCapacity,
      occupiedBeds: occupiedInRoom,
      availableBeds: freeInRoom,
      isBooked,
      isFullyBooked,
      bookings: bookingsInRoom
    };
  });

  const bookedRoomsCount = roomBreakdown.filter(rb => rb.isBooked).length;
  const fullyBookedRoomsCount = roomBreakdown.filter(rb => rb.isFullyBooked).length;
  const availableRoomsCount = roomBreakdown.filter(rb => rb.availableBeds > 0).length;

  return {
    dateStr,
    totalRooms,
    totalBeds,
    occupiedBedsCount,
    availableBedsCount,
    bookedRoomsCount,
    fullyBookedRoomsCount,
    availableRoomsCount,
    activeBookings,
    reservationCount: activeBookings.length,
    arrivals,
    departures,
    roomBreakdown,
    hasBookings: activeBookings.length > 0,
    isFull: availableBedsCount === 0 && totalBeds > 0
  };
}

/**
 * Generate 35 or 42 grid cells for the monthly calendar view.
 */
export function generateMonthGrid(year, monthZeroIndexed, reservations = [], rooms = [], todayStr) {
  const inventory = calculateInventory(rooms);
  const firstDayOfWeek = new Date(year, monthZeroIndexed, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, monthZeroIndexed + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, monthZeroIndexed, 0).getDate();

  const cells = [];

  // 1. Previous month trailing days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, monthZeroIndexed - 1, dayNum);
    const dateStr = formatDateKey(prevDate.getFullYear(), prevDate.getMonth(), dayNum);
    const avail = calculateDateAvailability(dateStr, reservations, rooms);

    cells.push({
      dateStr,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      ...avail,
      shortAvailabilityLabel: avail.isFull ? 'Full' : `${avail.availableBedsCount} free`,
      compactBookedLabel: avail.hasBookings ? `${avail.bookedRoomsCount} rm` : ''
    });
  }

  // 2. Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDateKey(year, monthZeroIndexed, d);
    const avail = calculateDateAvailability(dateStr, reservations, rooms);

    cells.push({
      dateStr,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      ...avail,
      shortAvailabilityLabel: avail.isFull ? 'Full' : `${avail.availableBedsCount} free`,
      compactBookedLabel: avail.hasBookings ? `${avail.bookedRoomsCount} rm` : ''
    });
  }

  // 3. Next month leading days (fill up to 35 or 42 cells)
  const targetLength = cells.length > 35 ? 42 : 35;
  const remaining = targetLength - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(year, monthZeroIndexed + 1, d);
    const dateStr = formatDateKey(nextDate.getFullYear(), nextDate.getMonth(), d);
    const avail = calculateDateAvailability(dateStr, reservations, rooms);

    cells.push({
      dateStr,
      dayNumber: d,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      ...avail,
      shortAvailabilityLabel: avail.isFull ? 'Full' : `${avail.availableBedsCount} free`,
      compactBookedLabel: avail.hasBookings ? `${avail.bookedRoomsCount} rm` : ''
    });
  }

  return {
    cells,
    totalRooms: inventory.totalRooms,
    totalBeds: inventory.totalBeds
  };
}

/**
 * Format a human-readable date for headers (e.g., "Wednesday, Oct 14, 2026").
 */
export function formatReadableHeading(dateStr) {
  if (!dateStr) return '';
  const { year, month, day } = parseDateKey(dateStr);
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Determine the unified sync status from real application state.
 * Never reports 'saved' merely because an action started.
 * Correctly accounts for multiple in-flight operations.
 * @param {Object} [options]
 * @param {boolean} [options.isInitialLoading]
 * @param {number} [options.inFlightSaves]
 * @param {number} [options.inFlightRefreshes]
 * @param {boolean} [options.isOffline]
 * @param {string | null} [options.lastSuccessfulRefreshTime]
 * @param {boolean} [options.saveSucceededRefreshFailed]
 * @param {{ type: string, message?: string } | null} [options.lastError]
 * @param {boolean} [options.justSaved]
 */
export function deriveSyncStatus({
  isInitialLoading = false,
  inFlightSaves = 0,
  inFlightRefreshes = 0,
  isOffline = false,
  lastSuccessfulRefreshTime = /** @type {string | null} */ (null),
  saveSucceededRefreshFailed = false,
  lastError = /** @type {{ type: string, message?: string } | null} */ (null),
  justSaved = false
} = {}) {
  if (isOffline) {
    return {
      state: 'offline',
      label: 'Offline',
      description: 'Network unavailable. Displayed data is cached. Saving while offline is not supported.',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      dotClass: 'bg-amber-500',
      canSave: false
    };
  }

  if (lastError && lastError.type === 'auth') {
    return {
      state: 'sync_failed',
      label: 'Auth Expired',
      description: lastError.message || 'Google authorization expired. Sign in to reconnect Google Sheets.',
      badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
      dotClass: 'bg-rose-500',
      canSave: false,
      isAuthError: true
    };
  }

  if (inFlightSaves > 0) {
    return {
      state: 'saving',
      label: inFlightSaves === 1 ? 'Saving...' : `Saving (${inFlightSaves})...`,
      description: 'Awaiting server confirmation for changes.',
      badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
      dotClass: 'bg-blue-500 animate-pulse',
      canSave: true
    };
  }

  if (isInitialLoading) {
    return {
      state: 'loading',
      label: 'Loading...',
      description: 'Fetching booking data and inventory from server.',
      badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
      dotClass: 'bg-slate-400 animate-pulse',
      canSave: false
    };
  }

  if (inFlightRefreshes > 0) {
    return {
      state: 'refreshing',
      label: 'Refreshing...',
      description: 'Retrieving latest server changes.',
      badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
      dotClass: 'bg-indigo-500 animate-spin',
      canSave: true
    };
  }

  if (saveSucceededRefreshFailed) {
    return {
      state: 'sync_failed',
      label: 'Saved · Refresh Failed',
      description: 'Your changes were saved to the server, but the latest data could not be refreshed. Check connectivity.',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      dotClass: 'bg-amber-500',
      canSave: true
    };
  }

  if (lastError && lastError.type === 'save') {
    return {
      state: 'sync_failed',
      label: 'Save Failed',
      description: lastError.message || 'Operation failed. Your form inputs remain intact.',
      badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
      dotClass: 'bg-rose-500',
      canSave: true
    };
  }

  if (lastError && lastError.type === 'refresh') {
    return {
      state: 'sync_failed',
      label: 'Refresh Failed',
      description: lastError.message || 'Could not fetch updates from server.',
      badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
      dotClass: 'bg-rose-500',
      canSave: true
    };
  }

  if (justSaved) {
    return {
      state: 'saved',
      label: 'Saved',
      description: lastSuccessfulRefreshTime
        ? `Server acknowledged changes. Reconciled at ${lastSuccessfulRefreshTime}.`
        : 'Server acknowledged changes and data has been reconciled.',
      badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      dotClass: 'bg-emerald-500',
      canSave: true
    };
  }

  return {
    state: 'saved',
    label: lastSuccessfulRefreshTime ? 'Synced' : 'Ready',
    description: lastSuccessfulRefreshTime
      ? `Last server sync: ${lastSuccessfulRefreshTime}`
      : 'Ready and synchronized',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-500',
    canSave: true
  };
}


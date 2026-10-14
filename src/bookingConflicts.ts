import type { Reservation } from './types.ts';
import { HOSTEL_ROOMS } from './types.ts';

export interface BookingConflict {
  id: string;
  type: 'double_booking' | 'whole_room_collision' | 'invalid_dates';
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  room: string;
  bedCode: string;
  overlapStart: string;
  overlapEnd: string;
  overlappingNights: number;
  reservationA: Reservation;
  reservationB?: Reservation;
}

/**
 * Normalizes room name for consistent comparison (e.g. "Njoro (Room 2)" -> "njoro")
 */
export function normalizeRoomName(roomStr: string = ''): string {
  const lower = roomStr.toLowerCase();
  for (const room of HOSTEL_ROOMS) {
    if (lower.includes(room.id) || lower.includes(room.name.toLowerCase())) {
      return room.name.toLowerCase();
    }
  }
  return lower.trim();
}

/**
 * Calculates number of nights between two YYYY-MM-DD date strings
 */
export function calculateNightsBetween(inDate: string, outDate: string): number {
  const d1 = new Date(inDate);
  const d2 = new Date(outDate);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Checks if two date ranges [startA, endA) and [startB, endB) overlap.
 * Note: Same-day turnover (endA === startB) is NOT an overlap.
 */
export function doDateRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

/**
 * Calculates the exact overlapping range between two date ranges
 */
export function getOverlapRange(startA: string, endA: string, startB: string, endB: string): { start: string; end: string; nights: number } {
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  const nights = calculateNightsBetween(start, end);
  return { start, end, nights };
}

/**
 * Detects all active conflicts across a list of reservations.
 */
export function detectBookingConflicts(reservations: Reservation[]): BookingConflict[] {
  const conflicts: BookingConflict[] = [];
  const activeBookings = (reservations || []).filter(r => {
    const status = (r.status || '').toLowerCase();
    return !status.includes('cancel');
  });

  // 1. Check for invalid dates within single reservations
  for (const r of activeBookings) {
    if (r.checkIn && r.checkOut && r.checkIn >= r.checkOut) {
      conflicts.push({
        id: `invalid-date-${r.id}`,
        type: 'invalid_dates',
        severity: 'critical',
        title: `Invalid Date Range on ${r.id}`,
        description: `Check-in date (${r.checkIn}) is on or after check-out date (${r.checkOut}) for guest ${r.guestName}.`,
        room: r.room || 'Unassigned',
        bedCode: r.bedCode || r.unitId || 'N/A',
        overlapStart: r.checkIn,
        overlapEnd: r.checkOut,
        overlappingNights: 0,
        reservationA: r
      });
    }
  }

  // 2. Check for collisions between pairs of bookings
  const seenPairs = new Set<string>();

  for (let i = 0; i < activeBookings.length; i++) {
    const resA = activeBookings[i];
    const roomA = normalizeRoomName(resA.room);
    const bedA = (resA.unitId || resA.bedCode || '').trim();

    for (let j = i + 1; j < activeBookings.length; j++) {
      const resB = activeBookings[j];
      const roomB = normalizeRoomName(resB.room);
      const bedB = (resB.unitId || resB.bedCode || '').trim();

      // Check date overlap
      if (!doDateRangesOverlap(resA.checkIn, resA.checkOut, resB.checkIn, resB.checkOut)) {
        continue;
      }

      const pairKey = [resA.id, resB.id].sort().join(':');
      if (seenPairs.has(pairKey)) continue;

      const overlap = getOverlapRange(resA.checkIn, resA.checkOut, resB.checkIn, resB.checkOut);

      // Conflict Case 1: Exact same bed booked
      if (roomA === roomB && bedA && bedB && bedA === bedB) {
        seenPairs.add(pairKey);
        conflicts.push({
          id: `conflict-${resA.id}-${resB.id}`,
          type: 'double_booking',
          severity: 'critical',
          title: `Double Booking on Bed ${bedA}`,
          description: `Bed ${bedA} in ${resA.room} is double-booked by ${resA.guestName} (${resA.id}) and ${resB.guestName} (${resB.id}) from ${overlap.start} to ${overlap.end} (${overlap.nights} night${overlap.nights === 1 ? '' : 's'}).`,
          room: resA.room,
          bedCode: bedA,
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
          overlappingNights: overlap.nights,
          reservationA: resA,
          reservationB: resB
        });
        continue;
      }

      // Conflict Case 2: Whole room collision (e.g. ALL booked while individual bed also booked)
      if (roomA === roomB && (bedA.includes('ALL') || bedB.includes('ALL'))) {
        seenPairs.add(pairKey);
        const wholeRoomRes = bedA.includes('ALL') ? resA : resB;
        const bedRes = bedA.includes('ALL') ? resB : resA;

        conflicts.push({
          id: `conflict-whole-${resA.id}-${resB.id}`,
          type: 'whole_room_collision',
          severity: 'critical',
          title: `Whole Room Collision in ${resA.room}`,
          description: `${wholeRoomRes.guestName} (${wholeRoomRes.id}) reserved the whole room, but bed ${bedRes.bedCode || bedRes.unitId} is also booked by ${bedRes.guestName} (${bedRes.id}) from ${overlap.start} to ${overlap.end}.`,
          room: resA.room,
          bedCode: bedRes.bedCode || bedRes.unitId || 'Whole Room',
          overlapStart: overlap.start,
          overlapEnd: overlap.end,
          overlappingNights: overlap.nights,
          reservationA: resA,
          reservationB: resB
        });
        continue;
      }
    }
  }

  return conflicts;
}

/**
 * Verifies if a prospective or edited booking would conflict with any existing reservations.
 */
export function checkNewBookingConflict(
  candidate: {
    id?: string;
    guestName?: string;
    room?: string;
    bedCode?: string;
    checkIn?: string;
    checkOut?: string;
  },
  existingReservations: Reservation[],
  excludeReservationId?: string
): BookingConflict | null {
  if (!candidate.room || !candidate.bedCode || !candidate.checkIn || !candidate.checkOut) {
    return null;
  }

  if (candidate.checkIn >= candidate.checkOut) {
    return {
      id: 'conflict-invalid-dates',
      type: 'invalid_dates',
      severity: 'critical',
      title: 'Invalid Date Range',
      description: 'Check-out date must be after check-in date.',
      room: candidate.room,
      bedCode: candidate.bedCode,
      overlapStart: candidate.checkIn,
      overlapEnd: candidate.checkOut,
      overlappingNights: 0,
      reservationA: candidate as Reservation
    };
  }

  const roomNorm = normalizeRoomName(candidate.room);
  const candidateBed = candidate.bedCode.trim();

  const activeBookings = (existingReservations || []).filter(r => {
    if (excludeReservationId && r.id === excludeReservationId) return false;
    const status = (r.status || '').toLowerCase();
    return !status.includes('cancel');
  });

  for (const existing of activeBookings) {
    const existingRoomNorm = normalizeRoomName(existing.room);
    const existingBed = (existing.unitId || existing.bedCode || '').trim();

    if (!doDateRangesOverlap(candidate.checkIn, candidate.checkOut, existing.checkIn, existing.checkOut)) {
      continue;
    }

    const overlap = getOverlapRange(candidate.checkIn, candidate.checkOut, existing.checkIn, existing.checkOut);

    // Same bed conflict
    if (roomNorm === existingRoomNorm && candidateBed === existingBed) {
      return {
        id: `conflict-candidate-${existing.id}`,
        type: 'double_booking',
        severity: 'critical',
        title: `Bed ${candidateBed} Already Booked`,
        description: `Bed ${candidateBed} in ${candidate.room} is already booked by ${existing.guestName} (${existing.id}) for ${overlap.nights} overlapping night(s) from ${overlap.start} to ${overlap.end}.`,
        room: candidate.room,
        bedCode: candidateBed,
        overlapStart: overlap.start,
        overlapEnd: overlap.end,
        overlappingNights: overlap.nights,
        reservationA: candidate as Reservation,
        reservationB: existing
      };
    }

    // Whole room collision
    if (roomNorm === existingRoomNorm && (candidateBed.includes('ALL') || existingBed.includes('ALL'))) {
      return {
        id: `conflict-candidate-whole-${existing.id}`,
        type: 'whole_room_collision',
        severity: 'critical',
        title: `Room Collision in ${candidate.room}`,
        description: candidateBed.includes('ALL')
          ? `Cannot book whole room: Bed ${existingBed} is already booked by ${existing.guestName} (${existing.id}) from ${overlap.start} to ${overlap.end}.`
          : `Cannot book bed ${candidateBed}: ${existing.guestName} (${existing.id}) already booked the entire room from ${overlap.start} to ${overlap.end}.`,
        room: candidate.room,
        bedCode: candidateBed,
        overlapStart: overlap.start,
        overlapEnd: overlap.end,
        overlappingNights: overlap.nights,
        reservationA: candidate as Reservation,
        reservationB: existing
      };
    }
  }

  return null;
}

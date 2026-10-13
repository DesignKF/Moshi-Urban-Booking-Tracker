import { HostelRoom, Reservation } from './types';

export interface RoomAvailabilityBreakdown {
  roomId: string;
  roomName: string;
  roomCode: string;
  capacity: number;
  occupiedBeds: number;
  availableBeds: number;
  isBooked: boolean;
  isFullyBooked: boolean;
  bookings: Reservation[];
}

export interface DateAvailability {
  dateStr: string;
  totalRooms: number;
  totalBeds: number;
  occupiedBedsCount: number;
  availableBedsCount: number;
  bookedRoomsCount: number;
  fullyBookedRoomsCount: number;
  availableRoomsCount: number;
  activeBookings: Reservation[];
  reservationCount: number;
  arrivals: Reservation[];
  departures: Reservation[];
  roomBreakdown: RoomAvailabilityBreakdown[];
  hasBookings: boolean;
  isFull: boolean;
}

export interface MonthGridCell extends DateAvailability {
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  shortAvailabilityLabel: string;
  compactBookedLabel: string;
}

export interface MonthGridResult {
  cells: MonthGridCell[];
  totalRooms: number;
  totalBeds: number;
}

export interface SyncStatusResult {
  state: 'loading' | 'saving' | 'saved' | 'refreshing' | 'offline' | 'sync_failed';
  label: string;
  description: string;
  badgeClass: string;
  dotClass: string;
  canSave: boolean;
  isAuthError?: boolean;
}

export interface DeriveSyncStatusParams {
  isInitialLoading?: boolean;
  inFlightSaves?: number;
  inFlightRefreshes?: number;
  isOffline?: boolean;
  lastSuccessfulRefreshTime?: string | null;
  saveSucceededRefreshFailed?: boolean;
  lastError?: { type: 'save' | 'refresh' | 'auth' | 'network'; message: string } | null;
  justSaved?: boolean;
}

export function formatDateKey(year: number, monthZeroIndexed: number, day: number): string;
export function parseDateKey(dateStr?: string): { year: number; month: number; day: number };
export function calculateInventory(rooms?: HostelRoom[]): { totalRooms: number; totalBeds: number };
export function isReservationActiveOnDate(reservation?: Reservation, dateStr?: string): boolean;
export function calculateDateAvailability(dateStr: string, reservations?: Reservation[], rooms?: HostelRoom[]): DateAvailability;
export function generateMonthGrid(
  year: number,
  monthZeroIndexed: number,
  reservations?: Reservation[],
  rooms?: HostelRoom[],
  todayStr?: string
): MonthGridResult;
export function formatReadableHeading(dateStr?: string): string;
export function deriveSyncStatus(params: DeriveSyncStatusParams): SyncStatusResult;

export interface HostelRoom {
  id: string;
  name: string;
  roomCode: string;
  type: string;
  capacity: number;
  rate: number;
  rateTZS: number;
  units: { id: string; place: string; capacity: number }[];
  amenities: string[];
  description: string;
}

export interface Reservation {
  id: string;
  guestName: string;
  guestId?: string;
  email?: string;
  phone: string;
  room: string;
  bedCode: string; // e.g. "N-B1L" or "M-S1"
  unitId: string;
  bedsCount: number;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;
  totalAmount: number; // in USD or chosen currency
  paidAmount: number;
  balanceDue: number;
  status: 'Confirmed' | 'Checked-in' | 'Checked-out' | 'Tentative' | 'No-show' | 'Cancelled' | 'Refunded' | string;
  notes?: string;
  platform?: string;
  currency?: 'TZS' | 'USD';
  loyalty?: string;
  discountPercent?: string;
}

export const HOSTEL_ROOMS: HostelRoom[] = [
  {
    id: "njoro",
    name: "Njoro",
    roomCode: "Room 2",
    type: "3 Bunk Beds (6 Beds)",
    capacity: 6,
    rate: 20,
    rateTZS: 52900,
    units: [
      { id: "N-B1L", place: "Bunk 1 lower", capacity: 1 },
      { id: "N-B1U", place: "Bunk 1 upper", capacity: 1 },
      { id: "N-B2L", place: "Bunk 2 lower", capacity: 1 },
      { id: "N-B2U", place: "Bunk 2 upper", capacity: 1 },
      { id: "N-B3L", place: "Bunk 3 lower", capacity: 1 },
      { id: "N-B3U", place: "Bunk 3 upper", capacity: 1 },
      { id: "N-ALL", place: "Whole room", capacity: 6 }
    ],
    amenities: ["3 Sturdy Wooden Bunks", "Bed Privacy Curtains", "Personal Reading Lamp", "Individual Metal Lockers"],
    description: "Spacious mixed backpacker dorm with custom bunk beds and secure backpack lockers."
  },
  {
    id: "bondeni",
    name: "Bondeni",
    roomCode: "Room 3",
    type: "2 Bunk Beds (4 Beds)",
    capacity: 4,
    rate: 20,
    rateTZS: 52900,
    units: [
      { id: "B-B1L", place: "Bunk 1 lower", capacity: 1 },
      { id: "B-B1U", place: "Bunk 1 upper", capacity: 1 },
      { id: "B-B2L", place: "Bunk 2 lower", capacity: 1 },
      { id: "B-B2U", place: "Bunk 2 upper", capacity: 1 },
      { id: "B-ALL", place: "Whole room", capacity: 4 }
    ],
    amenities: ["2 Solid Wooden Bunks", "Underbed Storage Space", "High-Output Ceiling Fan", "Courtyard Facing"],
    description: "Quiet 4-bed dorm room looking out into the central hostel courtyard."
  },
  {
    id: "mawenzi",
    name: "Mawenzi",
    roomCode: "Room 1",
    type: "1 Single Bed & 1 Bunk Bed (3 Beds)",
    capacity: 3,
    rate: 20,
    rateTZS: 52900,
    units: [
      { id: "M-S1", place: "Single bed", capacity: 1 },
      { id: "M-B1L", place: "Bunk 1 lower", capacity: 1 },
      { id: "M-B1U", place: "Bunk 1 upper", capacity: 1 },
      { id: "M-ALL", place: "Whole room", capacity: 3 }
    ],
    amenities: ["1 Single + 1 Bunk Bed", "Ground Floor Patio", "Garden Breeze", "Bed Linens Included"],
    description: "Cozy garden-level room with 1 single bed and 1 sturdy wooden bunk bed."
  },
  {
    id: "soweto",
    name: "Soweto",
    roomCode: "Room 4",
    type: "1 Single Bed & 1 Bunk Bed (3 Beds)",
    capacity: 3,
    rate: 20,
    rateTZS: 52900,
    units: [
      { id: "S-S1", place: "Single bed", capacity: 1 },
      { id: "S-B1L", place: "Bunk 1 lower", capacity: 1 },
      { id: "S-B1U", place: "Bunk 1 upper", capacity: 1 },
      { id: "S-ALL", place: "Whole room", capacity: 3 }
    ],
    amenities: ["1 Single + 1 Bunk Bed", "Dedicated Work Desk", "Mosquito Netting on Windows", "24/7 Hot Solar Water"],
    description: "Bright room with work desk, single bed, and single bunk bed."
  }
];

export interface ChangeLogEntry {
  id: string;
  action: 'create' | 'update' | 'delete' | 'status_change' | 'check_in' | 'check_out' | 'payment' | 'sync' | 'revert';
  title: string;
  description: string;
  targetId?: string;
  guestName?: string;
  timestamp: string; // ISO date string
  user: string;
  diffSummary?: string;
  snapshotBefore?: Reservation[];
}

// Initial bookings (empty for fresh start)
export const INITIAL_RESERVATIONS: Reservation[] = [];


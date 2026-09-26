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

// Initial bookings from the Moshi Urban Hostel booking spreadsheet
export const INITIAL_RESERVATIONS: Reservation[] = [
  {
    id: "MU-1",
    guestName: "Godwin Njau",
    guestId: "GN-0001",
    phone: "+255 754 112 344",
    room: "Mawenzi (Room 1)",
    bedCode: "M-S1",
    unitId: "M-S1",
    bedsCount: 1,
    checkIn: "2026-09-23",
    checkOut: "2026-09-27",
    nights: 4,
    totalAmount: 80,
    paidAmount: 80,
    balanceDue: 0,
    status: "Checked-in",
    platform: "Website",
    loyalty: "New / no recent stays",
    notes: "Safari traveler"
  },
  {
    id: "MU-2",
    guestName: "Jimmy Chami",
    guestId: "JC-0002",
    phone: "+255 713 882 109",
    room: "Njoro (Room 2)",
    bedCode: "N-B1L",
    unitId: "N-B1L",
    bedsCount: 1,
    checkIn: "2026-09-23",
    checkOut: "2026-09-27",
    nights: 4,
    totalAmount: 80,
    paidAmount: 80,
    balanceDue: 0,
    status: "Checked-in",
    platform: "Website",
    loyalty: "New / no recent stays",
    notes: "Kilimanjaro trek preparation"
  },
  {
    id: "MU-3",
    guestName: "Dominic Shoo",
    guestId: "DS-0003",
    phone: "+255 784 990 415",
    room: "Bondeni (Room 3)",
    bedCode: "B-B1L",
    unitId: "B-B1L",
    bedsCount: 1,
    checkIn: "2026-10-05",
    checkOut: "2026-10-10",
    nights: 5,
    totalAmount: 100,
    paidAmount: 0,
    balanceDue: 100,
    status: "Checked-in",
    platform: "Direct Booking",
    loyalty: "New / no recent stays",
    notes: "Group coordinator"
  },
  {
    id: "MU-4",
    guestName: "Jackson Shoo",
    guestId: "JS-0004",
    phone: "+255 655 432 198",
    room: "Soweto (Room 4)",
    bedCode: "S-S1",
    unitId: "S-S1",
    bedsCount: 1,
    checkIn: "2026-09-23",
    checkOut: "2026-09-24",
    nights: 1,
    totalAmount: 20,
    paidAmount: 20,
    balanceDue: 0,
    status: "Checked-in",
    platform: "Direct Booking",
    loyalty: "New / no recent stays",
    notes: "Transit guest"
  },
  {
    id: "MU-5",
    guestName: "Brian Kimario",
    guestId: "BK-0005",
    phone: "+255 712 345 678",
    room: "Njoro (Room 2)",
    bedCode: "N-B1U",
    unitId: "N-B1U",
    bedsCount: 1,
    checkIn: "2026-09-25",
    checkOut: "2026-09-26",
    nights: 1,
    totalAmount: 20,
    paidAmount: 20,
    balanceDue: 0,
    status: "Checked-in",
    platform: "Direct Booking",
    loyalty: "New / no recent stays",
    notes: "Weekend stay"
  },
  {
    id: "MU-6",
    guestName: "Gift Family",
    guestId: "GS-0006",
    phone: "+255 765 998 877",
    room: "Bondeni (Room 3)",
    bedCode: "B-ALL",
    unitId: "B-ALL",
    bedsCount: 4,
    checkIn: "2026-09-30",
    checkOut: "2026-10-05",
    nights: 5,
    totalAmount: 100,
    paidAmount: 100,
    balanceDue: 0,
    status: "Confirmed",
    platform: "Airbnb",
    loyalty: "New / no recent stays",
    notes: "Family booking"
  }
];

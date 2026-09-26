import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  clearAccessToken
} from './auth';
import {
  listUserSpreadsheets,
  getSpreadsheetDetails,
  readSheetRows,
  parseSheetToReservations,
  appendReservationToSheet,
  updateReservationInSheet,
  validateSpreadsheetById,
  formatA1Range,
  SheetFile
} from './sheetsService';
import {
  HOSTEL_ROOMS,
  INITIAL_RESERVATIONS,
  Reservation,
  HostelRoom
} from './types';
import {
  Calendar,
  Bed,
  Users,
  DollarSign,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  LogIn,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  Sparkles,
  Phone,
  Tag,
  ShieldCheck,
  Building2,
  ExternalLink,
  Trash2,
  X,
  Link as LinkIcon,
  Check,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Layers,
  Bell,
  BellRing,
  AlertTriangle,
  Menu
} from 'lucide-react';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'availability' | 'rooms' | 'sheets'>('overview');

  // Reservations Data
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    const saved = localStorage.getItem('muh_reservations_db');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return INITIAL_RESERVATIONS;
      }
    }
    return INITIAL_RESERVATIONS;
  });

  // Google Sheets integration state
  const [sheetsList, setSheetsList] = useState<SheetFile[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [sheetsLoadError, setSheetsLoadError] = useState<string | null>(null);
  const [manualSheetInput, setManualSheetInput] = useState<string>(() => {
    return localStorage.getItem('muh_active_sheet_id') || '';
  });
  const [selectedSheetId, setSelectedSheetId] = useState<string>(() => {
    return localStorage.getItem('muh_active_sheet_id') || '';
  });
  const [selectedSheetName, setSelectedSheetName] = useState<string>(() => {
    return localStorage.getItem('muh_active_sheet_name') || '';
  });
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [selectedTabName, setSelectedTabName] = useState<string>(() => {
    return localStorage.getItem('muh_active_tab_name') || 'Booking overview';
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error' | 'syncing'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');

  // UI Filters
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('muh_sidebar_collapsed') === 'true';
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [currency, setCurrency] = useState<'USD' | 'TZS' | 'EUR' | 'GBP'>('USD');
  const CURRENCY_RATES = { USD: 1, TZS: 2645, EUR: 0.92, GBP: 0.79 };

  // Availability timeline state
  const [timelineAnchor, setTimelineAnchor] = useState<Date>(new Date('2026-09-23'));

  // Modals
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Reservation | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [collectModalBooking, setCollectModalBooking] = useState<Reservation | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedBookingInfo, setSelectedBookingInfo] = useState<{
    roomName: string;
    dateStr: string;
    bookings: Reservation[];
  } | null>(null);

  // New/Edit Reservation Form State
  const [formData, setFormData] = useState({
    id: '',
    guestId: '',
    guestName: '',
    email: '',
    phone: '',
    room: 'Mawenzi (Room 1)',
    bedCode: 'M-S1',
    checkIn: '2026-09-25',
    checkOut: '2026-09-28',
    nights: 3,
    totalAmount: 60,
    paidAmount: 0,
    balanceDue: 60,
    status: 'Confirmed',
    notes: '',
    platform: 'Direct Booking',
    currency: 'USD'
  });

  // Save to LocalStorage whenever reservations change
  useEffect(() => {
    localStorage.setItem('muh_reservations_db', JSON.stringify(reservations));
  }, [reservations]);

  // Init Auth on Mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        loadSpreadsheets(accessToken);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Format money helper
  const formatMoney = (amountUSD: number) => {
    const rate = CURRENCY_RATES[currency] || 1;
    const val = amountUSD * rate;
    if (currency === 'USD') return `$${Math.round(val).toLocaleString()}`;
    if (currency === 'TZS') return `TZS ${Math.round(val).toLocaleString()}`;
    if (currency === 'EUR') return `€${Math.round(val).toLocaleString()}`;
    if (currency === 'GBP') return `£${Math.round(val).toLocaleString()}`;
    return `$${amountUSD}`;
  };

  // Google Sign-in Handler
  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        await loadSpreadsheets(res.accessToken);
        triggerToast('Connected to Google Account successfully!', 'success');
      }
    } catch (err: any) {
      console.error('Sign in error:', err);
      triggerToast(err.message || 'Failed to sign in with Google', 'error');
    } finally {
      setIsSigningIn(false);
    }
  };

  // Google Sign-out Handler
  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    triggerToast('Signed out of Google account', 'info');
  };

  // Load User's Spreadsheets from Drive
  const loadSpreadsheets = async (accessToken: string) => {
    setIsLoadingSheets(true);
    setSheetsLoadError(null);
    try {
      const files = await listUserSpreadsheets(accessToken);
      setSheetsList(files);

      // Auto-select spreadsheet if matching saved ID or if name contains "moshi"
      const savedId = localStorage.getItem('muh_active_sheet_id');
      const moshiSheet =
        (savedId ? files.find(f => f.id === savedId) : null) ||
        files.find(f => f.name.toLowerCase().includes('moshi'));

      if (moshiSheet) {
        setSelectedSheetId(moshiSheet.id);
        setSelectedSheetName(moshiSheet.name);
        setManualSheetInput(moshiSheet.id);
        localStorage.setItem('muh_active_sheet_id', moshiSheet.id);
        localStorage.setItem('muh_active_sheet_name', moshiSheet.name);
        await loadSheetTabs(moshiSheet.id, accessToken);
      } else if (savedId) {
        // If savedId exists but wasn't in top files list, validate it directly
        await handleConnectManualSheet(savedId, accessToken);
      } else if (files.length > 0) {
        setSelectedSheetId(files[0].id);
        setSelectedSheetName(files[0].name);
        setManualSheetInput(files[0].id);
        localStorage.setItem('muh_active_sheet_id', files[0].id);
        localStorage.setItem('muh_active_sheet_name', files[0].name);
        await loadSheetTabs(files[0].id, accessToken);
      }
    } catch (err: any) {
      console.warn('Could not load Google Drive sheets:', err);
      const isExpired = err.message?.toLowerCase().includes('expired') || err.message?.includes('401');
      if (isExpired) {
        clearAccessToken();
        setToken(null);
        setSheetsLoadError('Google authorization token expired. Please click "Sign in with Google" below to refresh permissions.');
      } else {
        setSheetsLoadError(err.message || 'Unable to list files from Google Drive.');
      }
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Connect directly via Spreadsheet ID or Google Sheet URL
  const handleConnectManualSheet = async (inputStr?: string, activeToken?: string) => {
    const raw = (inputStr !== undefined ? inputStr : manualSheetInput).trim();
    if (!raw) {
      triggerToast('Please paste a Google Spreadsheet link or ID.', 'info');
      return;
    }

    const currentToken = activeToken || token || (await getAccessToken());
    if (!currentToken) {
      triggerToast('Please sign in with Google first.', 'error');
      return;
    }

    setIsLoadingSheets(true);
    setSheetsLoadError(null);
    try {
      const valid = await validateSpreadsheetById(raw, currentToken);
      if (valid) {
        setSelectedSheetId(valid.id);
        setSelectedSheetName(valid.name);
        setManualSheetInput(valid.id);
        localStorage.setItem('muh_active_sheet_id', valid.id);
        localStorage.setItem('muh_active_sheet_name', valid.name);

        // Add to sheetsList if not already there
        setSheetsList(prev => {
          if (prev.some(f => f.id === valid.id)) return prev;
          return [{ id: valid.id, name: valid.name, modifiedTime: new Date().toISOString() }, ...prev];
        });

        await loadSheetTabs(valid.id, currentToken);
        triggerToast(`Successfully connected to "${valid.name}"!`, 'success');
      }
    } catch (err: any) {
      console.error('Manual sheet connection failed:', err);
      setSheetsLoadError(`Cannot access sheet: ${err.message}`);
      triggerToast(`Connection failed: ${err.message}`, 'error');
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Load tabs of a selected spreadsheet
  const loadSheetTabs = async (spreadsheetId: string, accessToken: string) => {
    try {
      const details = await getSpreadsheetDetails(spreadsheetId, accessToken);
      const tabNames = details.sheets.map(s => s.title);
      setAvailableTabs(tabNames);

      // Auto-select tab named "Booking overview", "Bookings", or "Guest stays"
      const savedTab = localStorage.getItem('muh_active_tab_name');
      const preferredTab =
        (savedTab && tabNames.includes(savedTab) ? savedTab : null) ||
        tabNames.find(
          t =>
            t.toLowerCase().includes('booking overview') ||
            t.toLowerCase().includes('booking') ||
            t.toLowerCase().includes('guest')
        ) ||
        tabNames[0];

      if (preferredTab) {
        setSelectedTabName(preferredTab);
        localStorage.setItem('muh_active_tab_name', preferredTab);
        // Automatically sync initial data from the sheet
        syncFromGoogleSheet(spreadsheetId, preferredTab, accessToken);
      }
    } catch (err: any) {
      console.warn('Could not load sheet tabs:', err);
      setSheetsLoadError(`Error loading sheet tabs: ${err.message}`);
    }
  };

  // Pull data from Google Sheet
  const syncFromGoogleSheet = async (
    sheetId = selectedSheetId,
    tabName = selectedTabName,
    activeAccessToken = token
  ) => {
    if (!sheetId) {
      triggerToast('Please select a spreadsheet to synchronize.', 'info');
      return;
    }
    let currentToken = activeAccessToken;
    if (!currentToken) {
      currentToken = await getAccessToken();
    }
    if (!currentToken) {
      triggerToast('Please sign in to Google to sync with your spreadsheet.', 'info');
      setActiveTab('sheets');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('syncing');
    setSyncMessage(`Pulling records from "${tabName}"...`);

    try {
      const range = formatA1Range(tabName, 'A1:Z150');
      const rows = await readSheetRows(sheetId, range, currentToken);
      const parsed = parseSheetToReservations(rows);

      if (parsed.length > 0) {
        // Merge or replace with parsed records
        setReservations(parsed);
        setSyncStatus('success');
        const now = new Date().toLocaleTimeString();
        setLastSyncTime(now);
        setSyncMessage(`Synced ${parsed.length} reservations from Google Sheet at ${now}`);
        triggerToast(`Successfully pulled ${parsed.length} reservations from Google Sheets!`, 'success');
      } else {
        setSyncStatus('idle');
        setSyncMessage(`Connected to Google Sheet, but no reservation rows found in "${tabName}".`);
        triggerToast(`Sheet connected! Tab "${tabName}" has no data rows yet.`, 'info');
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      setSyncStatus('error');
      setSyncMessage(err.message || 'Error communicating with Google Sheets');
      triggerToast(`Sync error: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Push new/updated reservation to Google Sheet with User Confirmation
  const saveReservationToSheet = async (resData: Reservation, isNew: boolean) => {
    let currentToken = token;
    if (!currentToken) {
      currentToken = await getAccessToken();
    }

    if (!currentToken || !selectedSheetId) {
      // Local fallback with notice
      triggerToast(
        `Saved ${resData.id} to local app. Connect Google Sheets under "Spreadsheet Database" to synchronize automatically.`,
        'info'
      );
      return;
    }

    setIsSyncing(true);
    try {
      if (isNew) {
        await appendReservationToSheet(selectedSheetId, selectedTabName, resData, currentToken);
        triggerToast(`Appended ${resData.id} directly to Google Sheet tab "${selectedTabName}"!`, 'success');
      } else {
        await updateReservationInSheet(selectedSheetId, selectedTabName, resData, currentToken);
        triggerToast(`Updated ${resData.id} in Google Sheet tab "${selectedTabName}"!`, 'success');
      }
      setLastSyncTime(new Date().toLocaleTimeString());
      setSyncStatus('success');
    } catch (err: any) {
      console.error('Error saving to sheet:', err);
      triggerToast(`Saved locally, but Google Sheets update failed: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Toast notification helper
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const triggerToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Handle open New Reservation modal
  const handleOpenNewModal = (prefillRoom?: string, prefillDate?: string) => {
    const targetRoom = prefillRoom || 'Mawenzi (Room 1)';
    const roomObj = HOSTEL_ROOMS.find(r => targetRoom.includes(r.name)) || HOSTEL_ROOMS[0];
    const defaultUnit = roomObj.units[0]?.id || 'M-S1';

    const checkIn = prefillDate || '2026-09-25';
    const nextDate = new Date(checkIn);
    nextDate.setDate(nextDate.getDate() + 3);
    const checkOut = nextDate.toISOString().split('T')[0];

    // Find highest existing MU ID number and GS ID number
    let maxIdNum = 0;
    let maxGuestNum = 0;
    reservations.forEach(r => {
      const match = r.id.match(/^MU-(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxIdNum) maxIdNum = n;
      }
      if (r.guestId) {
        const gMatch = r.guestId.match(/(?:GS-|G-)?(\d+)/i);
        if (gMatch) {
          const gn = parseInt(gMatch[1], 10);
          if (gn > maxGuestNum) maxGuestNum = gn;
        }
      }
    });
    const nextId = `MU-${maxIdNum + 1}`;
    const nextGuestNum = Math.max(maxIdNum + 1, maxGuestNum + 1);
    const nextGuestId = `GS-${String(nextGuestNum).padStart(4, '0')}`;

    setEditingBooking(null);
    setFormData({
      id: nextId,
      guestId: nextGuestId,
      guestName: '',
      email: '',
      phone: '',
      room: targetRoom,
      bedCode: defaultUnit,
      checkIn: checkIn,
      checkOut: checkOut,
      nights: 3,
      totalAmount: 60,
      paidAmount: 0,
      balanceDue: 60,
      status: 'Confirmed',
      notes: '',
      platform: 'Direct Booking',
      currency: 'USD'
    });
    setIsBookingModalOpen(true);
  };

  // Handle Edit Reservation modal
  const handleOpenEditModal = (r: Reservation) => {
    setEditingBooking(r);

    // Reconcile bed code with selected room:
    // e.g. If r.room is Soweto but bed is M-B1L, pick the valid bed code for Soweto so it never violates Google Sheets list validation
    const roomObj = HOSTEL_ROOMS.find(room => r.room.includes(room.name)) || HOSTEL_ROOMS[0];
    let bedCode = r.unitId || r.bedCode;
    const isValidBedForRoom = roomObj.units.some(u => u.id === bedCode);
    if (!isValidBedForRoom) {
      bedCode = roomObj.units[0]?.id || 'M-S1';
    }

    setFormData({
      id: r.id,
      guestId: r.guestId || `GS-${r.id.replace(/[^0-9]/g, '').padStart(4, '0')}`,
      guestName: r.guestName,
      email: r.email || '',
      phone: r.phone || '',
      room: r.room,
      bedCode: bedCode,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: r.nights,
      totalAmount: r.totalAmount,
      paidAmount: r.paidAmount,
      balanceDue: r.balanceDue,
      status: r.status,
      notes: r.notes || '',
      platform: r.platform || 'Direct Booking',
      currency: r.currency || 'USD'
    });
    setIsBookingModalOpen(true);
  };

  // Form submit handler: directly saves and syncs to Google Sheet with visual loading feedback
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.guestName.trim()) {
      triggerToast('Please provide a guest name', 'error');
      return;
    }

    // Verify bed code matches the room category:
    const roomObj = HOSTEL_ROOMS.find(room => formData.room.includes(room.name)) || HOSTEL_ROOMS[0];
    let reconciledBed = formData.bedCode;
    if (!roomObj.units.some(u => u.id === reconciledBed)) {
      reconciledBed = roomObj.units[0]?.id || 'M-S1';
    }

    const isNew = !editingBooking;
    const finalRecord: Reservation = {
      id: formData.id || `MU-${reservations.length + 1}`,
      guestId: formData.guestId.trim() || `GS-${(formData.id || '').replace(/[^0-9]/g, '').padStart(4, '0')}`,
      guestName: formData.guestName.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      room: formData.room,
      bedCode: reconciledBed,
      unitId: reconciledBed,
      bedsCount: reconciledBed.includes('ALL') ? 4 : 1,
      checkIn: formData.checkIn,
      checkOut: formData.checkOut,
      nights: Number(formData.nights) || 1,
      totalAmount: Number(formData.totalAmount) || 0,
      paidAmount: Number(formData.paidAmount) || 0,
      balanceDue: Math.max(0, Number(formData.totalAmount) - Number(formData.paidAmount)),
      status: formData.status,
      notes: formData.notes.trim(),
      platform: formData.platform,
      currency: formData.currency as 'TZS' | 'USD'
    };

    // Close booking modal immediately and update local state
    setIsBookingModalOpen(false);

    if (isNew) {
      setReservations(prev => [finalRecord, ...prev]);
      triggerToast(`Saved ${finalRecord.id} for ${finalRecord.guestName}! Syncing with Google Sheets...`, 'info');
    } else {
      setReservations(prev => prev.map(item => (item.id === finalRecord.id ? finalRecord : item)));
      triggerToast(`Updated ${finalRecord.id}! Syncing with Google Sheets...`, 'info');
    }

    // Direct Google Sheets API sync
    await saveReservationToSheet(finalRecord, isNew);
  };

  // Check-in guest quick action
  const handleCheckIn = (bookingId: string) => {
    const booking = reservations.find(r => r.id === bookingId);
    if (!booking) return;

    setConfirmModal({
      isOpen: true,
      title: 'Confirm Guest Check-in',
      message: `Mark ${booking.guestName} (${booking.id}) as Checked-in and update Google Sheet?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        const updated = { ...booking, status: 'Checked-in' };
        setReservations(prev => prev.map(r => (r.id === bookingId ? updated : r)));
        await saveReservationToSheet(updated, false);
        triggerToast(`Checked in ${booking.guestName}!`, 'success');
      }
    });
  };

  // Quick Collect Balance Full
  const handleConfirmCollect = async () => {
    if (!collectModalBooking) return;
    const b = collectModalBooking;
    const updated: Reservation = {
      ...b,
      paidAmount: b.totalAmount,
      balanceDue: 0
    };

    setCollectModalBooking(null);
    setReservations(prev => prev.map(r => (r.id === b.id ? updated : r)));
    await saveReservationToSheet(updated, false);
    triggerToast(`Collected balance for ${b.guestName}. Marked fully paid!`, 'success');
  };

  // Delete booking with explicit confirmation
  const handleDeleteBooking = (bookingId: string) => {
    const booking = reservations.find(r => r.id === bookingId);
    if (!booking) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Reservation',
      message: `Are you sure you want to permanently delete booking ${bookingId} (${booking.guestName})? This will remove the booking from your system.`,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsBookingModalOpen(false);
        setReservations(prev => prev.filter(r => r.id !== bookingId));
        triggerToast(`Deleted reservation ${bookingId}`, 'info');
      }
    });
  };

  // Date recalculation when dates change in modal
  const handleDateChange = (inDate: string, outDate: string) => {
    if (inDate && outDate) {
      const d1 = new Date(inDate);
      const d2 = new Date(outDate);
      const diff = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
      const total = diff * 20;
      setFormData(prev => ({
        ...prev,
        checkIn: inDate,
        checkOut: outDate,
        nights: diff,
        totalAmount: total,
        balanceDue: Math.max(0, total - prev.paidAmount)
      }));
    }
  };

  // Filtered reservations for the bookings tab
  const filteredBookings = reservations.filter(r => {
    if (statusFilter !== 'ALL' && r.status.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    if (globalSearch.trim()) {
      const text = `${r.id} ${r.guestName} ${r.phone} ${r.room} ${r.unitId} ${r.status} ${r.notes}`.toLowerCase();
      if (!text.includes(globalSearch.toLowerCase().trim())) return false;
    }
    return true;
  });

  // Calculate Operational Metrics
  const todayStr = '2026-09-25';
  const arrivalsToday = reservations.filter(
    r => (r.checkIn === '2026-09-23' || r.checkIn === todayStr) && r.status !== 'Checked-out' && r.status !== 'Cancelled'
  );
  const checkedInCount = reservations.filter(r => r.status.toLowerCase() === 'checked-in').length;
  const departuresToday = reservations.filter(r => r.checkOut === todayStr).length;
  const bookedBedsCount = reservations.filter(
    r => r.status.toLowerCase() === 'checked-in' || r.status.toLowerCase() === 'confirmed'
  ).length;
  const freeBedsCount = Math.max(0, 16 - bookedBedsCount);
  const pendingPayments = reservations.filter(r => r.balanceDue > 0);

  // Operational Action Items & Notifications
  const actionItems: {
    id: string;
    type: 'checkin' | 'payment' | 'mismatch' | 'airport' | 'sync';
    title: string;
    description: string;
    severity: 'high' | 'medium' | 'info';
    booking?: Reservation;
  }[] = [];

  // 1. Room / bed mismatch detection (e.g., Bed doesn't match selected room)
  reservations.forEach(r => {
    const roomPrefix = r.room.toLowerCase().includes('mawenzi') ? 'M'
      : r.room.toLowerCase().includes('njoro') ? 'N'
      : r.room.toLowerCase().includes('bondeni') ? 'B'
      : r.room.toLowerCase().includes('soweto') ? 'S' : '';
    const bedPrefix = (r.unitId || r.bedCode || '').charAt(0).toUpperCase();
    if (roomPrefix && bedPrefix && roomPrefix !== bedPrefix) {
      actionItems.push({
        id: `mismatch-${r.id}`,
        type: 'mismatch',
        title: `Room/Bed Mismatch: ${r.id}`,
        description: `${r.guestName} is assigned to ${r.room} but bed code is ${r.unitId || r.bedCode}. Click to correct.`,
        severity: 'high',
        booking: r
      });
    }
  });

  // 2. Pending arrivals today awaiting check-in
  arrivalsToday.filter(r => r.status.toLowerCase() !== 'checked-in').forEach(r => {
    actionItems.push({
      id: `checkin-${r.id}`,
      type: 'checkin',
      title: `Arrival Due: ${r.guestName}`,
      description: `${r.id} scheduled for arrival on ${r.checkIn} in ${r.room} (${r.unitId || r.bedCode}).`,
      severity: 'medium',
      booking: r
    });
  });

  // 3. Outstanding balance on check-in or confirmed
  reservations.filter(r => r.status.toLowerCase() === 'checked-in' && r.balanceDue > 0).forEach(r => {
    actionItems.push({
      id: `payment-${r.id}`,
      type: 'payment',
      title: `Collect Balance: ${r.guestName}`,
      description: `Folio has an outstanding balance of $${r.balanceDue.toFixed(2)} (${r.id}).`,
      severity: 'medium',
      booking: r
    });
  });

  // 4. Airport pickup or special request in notes
  reservations.filter(r => r.notes && (r.notes.toLowerCase().includes('airport') || r.notes.toLowerCase().includes('pick up') || r.notes.toLowerCase().includes('pickup'))).forEach(r => {
    actionItems.push({
      id: `airport-${r.id}`,
      type: 'airport',
      title: `Airport Transfer Request`,
      description: `${r.guestName} (${r.id}): "${r.notes}"`,
      severity: 'info',
      booking: r
    });
  });

  return (
    <div className="flex h-screen w-full bg-[#faf8f5] text-slate-800 font-sans antialiased overflow-hidden selection:bg-amber-100 selection:text-amber-900">
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[80] animate-bounce duration-300 pointer-events-auto">
          <div
            className={`px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center space-x-2.5 ${
              toast.type === 'success'
                ? 'bg-emerald-800 text-white'
                : toast.type === 'error'
                ? 'bg-rose-800 text-white'
                : 'bg-[#0d1726] text-white'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-300" />}
            {toast.type === 'info' && <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-3 text-amber-600 mb-3">
              <div className="p-2.5 bg-amber-50 rounded-xl">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 font-serif">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="px-5 py-2 text-xs font-bold text-[#0d1726] bg-[#d99b26] hover:bg-[#c5891c] rounded-xl shadow-md transition"
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR NAVIGATION (Desktop & Mobile Drawer) */}
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        className={`${
          sidebarCollapsed ? 'md:w-20' : 'md:w-64'
        } ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#0d1726] text-slate-300 flex flex-col shrink-0 border-r border-[#19263b] select-none transition-all duration-300 ease-in-out`}
      >
        {/* Brand Header */}
        <div className={`p-4 border-b border-[#1b2a41] flex items-center ${sidebarCollapsed ? 'md:justify-center justify-between' : 'justify-between'} min-h-[76px]`}>
          {(!sidebarCollapsed || mobileSidebarOpen) ? (
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <img
                src="/moshi_urban_logo_horizontal_white.svg"
                alt="Moshi Urban Hostel & Backpackers"
                className="h-10 w-auto object-contain max-w-[170px]"
              />
              <span className="bg-[#d99b26]/25 text-[#e9af43] text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#d99b26]/50 shrink-0">
                PMS
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center group relative cursor-pointer" onClick={() => {
              setSidebarCollapsed(false);
              localStorage.setItem('muh_sidebar_collapsed', 'false');
            }} title="Moshi Urban Hostel PMS (Click to expand)">
              <img
                src="/favicon.svg"
                alt="Moshi Urban"
                className="w-10 h-10 object-contain hover:scale-110 transition-transform"
              />
              <span className="text-[9px] text-[#e9af43] font-bold mt-1 tracking-wider">
                PMS
              </span>
            </div>
          )}

          {/* Desktop Collapse/Expand Toggle Button */}
          <button
            onClick={() => {
              setSidebarCollapsed(prev => {
                const next = !prev;
                localStorage.setItem('muh_sidebar_collapsed', String(next));
                return next;
              });
            }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden md:flex ${
              sidebarCollapsed
                ? 'absolute -right-3 top-6 bg-[#d99b26] text-[#0d1726] shadow-md hover:bg-[#c5891c]'
                : 'text-slate-400 hover:text-white hover:bg-[#1a283f]'
            } p-1.5 rounded-lg transition z-20 cursor-pointer items-center justify-center`}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
            ) : (
              <ChevronLeft className="w-4 h-4 stroke-[2]" />
            )}
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1.5 flex-1 text-xs font-medium">
          <button
            onClick={() => {
              setActiveTab('overview');
              setMobileSidebarOpen(false);
            }}
            title="Overview"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:px-2 md:py-3 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'overview'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 border-[#d99b26]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center space-x-3' : 'space-x-3'}`}>
              <Layers className={`w-5 h-5 shrink-0 ${activeTab === 'overview' ? 'text-[#d99b26]' : 'text-slate-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Overview</span>}
            </div>
            {(!sidebarCollapsed || mobileSidebarOpen) && arrivalsToday.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#d99b26] text-[#0d1726] font-bold text-[10px] flex items-center justify-center">
                {arrivalsToday.length}
              </span>
            )}
            {sidebarCollapsed && !mobileSidebarOpen && arrivalsToday.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-[#d99b26] ring-2 ring-[#0d1726]" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('bookings');
              setMobileSidebarOpen(false);
            }}
            title="Bookings"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:px-2 md:py-3 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'bookings'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 border-[#d99b26]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center space-x-3' : 'space-x-3'}`}>
              <Calendar className={`w-5 h-5 shrink-0 ${activeTab === 'bookings' ? 'text-[#d99b26]' : 'text-slate-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Bookings</span>}
            </div>
            {(!sidebarCollapsed || mobileSidebarOpen) && (
              <span className="text-[10px] font-mono text-slate-500">{reservations.length}</span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('availability');
              setMobileSidebarOpen(false);
            }}
            title="Availability"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:px-2 md:py-3 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer group ${
              activeTab === 'availability'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 border-[#d99b26]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center space-x-3' : 'space-x-3'}`}>
              <Bed className={`w-5 h-5 shrink-0 ${activeTab === 'availability' ? 'text-[#d99b26]' : 'text-slate-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Availability</span>}
            </div>
          </button>

          <button
            onClick={() => {
              setActiveTab('rooms');
              setMobileSidebarOpen(false);
            }}
            title="Rooms & Units"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:px-2 md:py-3 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer group ${
              activeTab === 'rooms'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 border-[#d99b26]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center space-x-3' : 'space-x-3'}`}>
              <Building2 className={`w-5 h-5 shrink-0 ${activeTab === 'rooms' ? 'text-[#d99b26]' : 'text-slate-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Rooms & Units</span>}
            </div>
          </button>

          <button
            onClick={() => {
              setActiveTab('sheets');
              setMobileSidebarOpen(false);
            }}
            title="Spreadsheet Database"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:px-2 md:py-3 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'sheets'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 border-[#d99b26]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center space-x-3' : 'space-x-3'}`}>
              <FileSpreadsheet className={`w-5 h-5 shrink-0 ${activeTab === 'sheets' ? 'text-[#d99b26]' : 'text-emerald-400'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Spreadsheet Database</span>}
            </div>
            {(!sidebarCollapsed || mobileSidebarOpen) && (
              <span
                className={`w-2 h-2 rounded-full ${
                  user ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
            )}
            {sidebarCollapsed && !mobileSidebarOpen && (
              <span
                className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                  user ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
            )}
          </button>
        </nav>

        {/* User Account / Google Connection Footer */}
        <div className="p-3 border-t border-[#1b2a41] bg-[#09111d]">
          {user ? (
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center justify-between' : 'justify-between'} px-1 py-1.5`}>
              <div className="flex items-center space-x-2.5 overflow-hidden" title={user.displayName || user.email || 'Google Account'}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-lg object-cover shadow shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-[#d99b26] text-[#0d1726] font-bold text-xs flex items-center justify-center shadow shrink-0">
                    {user.email?.charAt(0).toUpperCase() || 'K'}
                  </div>
                )}
                {(!sidebarCollapsed || mobileSidebarOpen) && (
                  <div className="truncate">
                    <p className="text-xs font-bold text-white tracking-tight truncate">
                      {user.displayName || 'Google Account'}
                    </p>
                    <p className="text-[10px] text-emerald-400 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      <span>Sheets Connected</span>
                    </p>
                  </div>
                )}
              </div>
              {(!sidebarCollapsed || mobileSidebarOpen) && (
                <button
                  onClick={handleSignOut}
                  title="Disconnect Google Account"
                  className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="p-1">
              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                title="Connect Sheets (Sign in with Google)"
                className={`w-full flex items-center justify-center ${
                  sidebarCollapsed ? 'md:p-2 space-x-2 py-2 px-3' : 'space-x-2 py-2 px-3'
                } rounded-xl bg-white text-slate-800 hover:bg-slate-100 text-xs font-semibold shadow-xs transition cursor-pointer`}
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.27-2.09 3.67-5.17 3.67-9.15z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.25v3.15C3.25 21.36 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.25C.45 8.22 0 10.06 0 12s.45 3.78 1.25 5.39l4.02-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.25 2.64 1.25 6.61l4.02 3.15c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                {(!sidebarCollapsed || mobileSidebarOpen) && <span>{isSigningIn ? 'Connecting...' : 'Connect Sheets'}</span>}
              </button>
            </div>
          )}
        </div>

      </aside>

      {/* MAIN VIEWPORT */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Top Header Controls */}
        <header className="bg-white/95 backdrop-blur-xs border-b border-[#e8e4dc] sticky top-0 z-30 px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Left: Mobile Menu Toggle & Search Bar */}
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-2 rounded-xl border border-[#e8e4dc] text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              title="Open Navigation Menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Search bar */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                placeholder="Search guest, ID, phone..."
                className="w-full bg-[#f6f3ed] border border-[#e5dfd3] rounded-xl pl-8 sm:pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#d99b26] focus:bg-white transition"
              />
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 absolute left-2.5 sm:left-3 top-2.5" />
            </div>
          </div>

          {/* Right Header Buttons */}
          <div className="flex items-center space-x-1.5 sm:space-x-3">
            
            {/* Action Items Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setIsNotificationsOpen(prev => !prev)}
                className={`relative p-2 rounded-xl border transition cursor-pointer flex items-center justify-center ${
                  actionItems.length > 0
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                    : 'bg-white hover:bg-slate-50 text-slate-500 border-[#e8e4dc]'
                }`}
                title="Operational action items"
              >
                {actionItems.some(a => a.severity === 'high') ? (
                  <BellRing className="w-4 h-4 text-amber-600 animate-wiggle" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                {actionItems.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-white rounded-full font-bold text-[9px] flex items-center justify-center shadow-xs">
                    {actionItems.length}
                  </span>
                )}
              </button>

              {/* Notification Popover Dropdown */}
              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-72 sm:w-96 bg-white rounded-2xl shadow-2xl border border-[#e8e4dc] z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-3.5 bg-[#0d1726] text-white flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Bell className="w-4 h-4 text-[#d99b26]" />
                      <span className="font-bold text-xs">Action Center</span>
                      <span className="bg-[#d99b26]/20 text-[#e9af43] text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold">
                        {actionItems.length} tasks
                      </span>
                    </div>
                    <button
                      onClick={() => setIsNotificationsOpen(false)}
                      className="text-slate-400 hover:text-white p-1 rounded-md"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-[#f2ede4]">
                    {actionItems.length === 0 ? (
                      <div className="p-6 text-center">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                        <p className="text-xs font-bold text-slate-800">All caught up!</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">No critical warnings or pending room actions.</p>
                      </div>
                    ) : (
                      actionItems.map(item => (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (item.booking) {
                              handleOpenEditModal(item.booking);
                            }
                            setIsNotificationsOpen(false);
                          }}
                          className="p-3 hover:bg-[#faf8f5] transition cursor-pointer flex items-start space-x-2.5 text-left"
                        >
                          <div className="mt-0.5 shrink-0">
                            {item.severity === 'high' ? (
                              <div className="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </div>
                            ) : item.type === 'checkin' ? (
                              <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                                <Users className="w-3.5 h-3.5" />
                              </div>
                            ) : item.type === 'payment' ? (
                              <div className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                                <CreditCard className="w-3.5 h-3.5" />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                <Sparkles className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-900 leading-tight">{item.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                            <div className="mt-1 flex items-center space-x-2 text-[10px] text-amber-700 font-semibold">
                              <span>Take action &rarr;</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {actionItems.length > 0 && (
                    <div className="p-2.5 bg-[#fbf9f5] border-t border-[#f1ede4] text-center">
                      <p className="text-[10px] text-slate-400">Click any notification to resolve or view the booking</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Direct Google Sheets Sync Button */}
            <button
              onClick={() => syncFromGoogleSheet()}
              disabled={isSyncing}
              className={`hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                user && selectedSheetId
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
              <span className="hidden lg:inline">
                {isSyncing
                  ? 'Syncing...'
                  : user && selectedSheetId
                  ? 'Sheet Synced'
                  : 'Connect Sheet'}
              </span>
            </button>

            {/* Currency Selector */}
            <div className="flex bg-[#f6f3ed] p-0.5 rounded-lg border border-[#e5dfd3] text-[11px] font-semibold">
              {(['USD', 'TZS', 'EUR'] as const).map(curr => (
                <button
                  key={curr}
                  onClick={() => setCurrency(curr)}
                  className={`px-1.5 sm:px-2 py-0.5 rounded transition ${
                    currency === curr ? 'bg-[#d99b26] text-[#0d1726] font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>

            {/* Create Reservation Button */}
            <button
              onClick={() => handleOpenNewModal()}
              className="flex items-center space-x-1.5 bg-[#d99b26] hover:bg-[#c5891c] text-[#0d1726] font-bold text-xs px-3 sm:px-4 py-2 rounded-xl shadow-xs transition transform active:scale-95 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Reservation</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

        </header>

        {/* Content Panes */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">

          {/* ======================================================== */}
          {/* TAB 1: OVERVIEW                                          */}
          {/* ======================================================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              
              {/* Header Title */}
              <div>
                <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Overview</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Daily operational tasks, live room and bed inventory, pending payments, and revenue synchronized with Google Sheets.
                </p>
              </div>

              {/* Action Center Banner when action items exist */}
              {actionItems.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 shadow-xs">
                  <div className="flex items-center justify-between pb-2.5 border-b border-amber-200/60">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500 text-slate-900 flex items-center justify-center font-bold">
                        <AlertTriangle className="w-4 h-4 text-slate-950" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-xs tracking-tight">
                          Action Required ({actionItems.length} items)
                        </h3>
                        <p className="text-[10px] text-amber-900/70">
                          Critical alerts, room mismatches, or arrivals requiring attention
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-200/60 px-2 py-0.5 rounded-full">
                      Immediate Action
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {actionItems.slice(0, 6).map(item => (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (item.booking) handleOpenEditModal(item.booking);
                        }}
                        className="bg-white/90 hover:bg-white p-3 rounded-xl border border-amber-200/70 shadow-2xs hover:shadow-xs transition cursor-pointer flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-900 line-clamp-1">{item.title}</span>
                            {item.severity === 'high' && (
                              <span className="text-[9px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
                                Urgent
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                        <div className="mt-2 text-[10px] text-amber-700 font-bold flex items-center space-x-1">
                          <span>Review & fix</span>
                          <span>&rarr;</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4 KPI Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs flex justify-between items-start">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Arrivals today</span>
                    <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 font-serif mt-1">{arrivalsToday.length}</h3>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {arrivalsToday.filter(r => r.status.toLowerCase() !== 'checked-in').length} awaiting check-in
                    </p>
                  </div>
                  <span className="text-emerald-700 bg-emerald-50 p-2.5 rounded-xl border border-emerald-100">
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs flex justify-between items-start">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Departures today</span>
                    <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 font-serif mt-1">{departuresToday}</h3>
                    <p className="text-[11px] text-slate-500 mt-1">Check-out by 10:00 AM</p>
                  </div>
                  <span className="text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-100">
                    <LogOut className="w-4 h-4" />
                  </span>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs flex justify-between items-start">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Checked-in</span>
                    <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 font-serif mt-1">{checkedInCount}</h3>
                    <p className="text-[11px] text-slate-500 mt-1">{checkedInCount} guests in-house</p>
                  </div>
                  <span className="text-blue-700 bg-blue-50 p-2.5 rounded-xl border border-blue-100">
                    <Users className="w-4 h-4" />
                  </span>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs flex justify-between items-start">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Beds free tonight</span>
                    <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 font-serif mt-1">{freeBedsCount}</h3>
                    <p className="text-[11px] text-slate-500 mt-1">{bookedBedsCount} of 16 beds booked</p>
                  </div>
                  <span className="text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-100">
                    <Bed className="w-4 h-4" />
                  </span>
                </div>
              </div>

              {/* Arrivals Today List */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-4 sm:p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#f1ede4]">
                  <div>
                    <h3 className="font-bold font-serif text-slate-900 text-sm sm:text-base">Arrivals today</h3>
                    <p className="text-[11px] text-slate-500">Guests expected to arrive today at Moshi Urban Hostel</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-800 font-mono">
                    {arrivalsToday.length} arrivals
                  </span>
                </div>

                <div className="space-y-2.5">
                  {arrivalsToday.map(r => (
                    <div
                      key={r.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#faf8f5] border border-[#ede9e1] gap-2.5"
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 text-xs sm:text-sm">{r.guestName}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{r.id}</span>
                          <span className="text-[11px] font-mono font-bold text-amber-900 bg-amber-50/80 px-1.5 py-0.5 rounded border border-amber-200/80">
                            {r.unitId || r.bedCode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          {r.room} <span aria-hidden="true">·</span> Phone: <span className="text-slate-700 font-mono">{r.phone || 'N/A'}</span> <span aria-hidden="true">·</span> Balance due:{' '}
                          <strong className={r.balanceDue > 0 ? 'text-slate-900 font-bold' : 'text-slate-500'}>
                            {formatMoney(r.balanceDue)}
                          </strong>
                        </p>
                      </div>
                      <div className="shrink-0 self-end sm:self-center">
                        {r.status.toLowerCase() === 'checked-in' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Checked in</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleCheckIn(r.id)}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                          >
                            <span>Check in</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {arrivalsToday.length === 0 && (
                    <p className="text-xs text-slate-400 italic py-2">No arrivals scheduled for today.</p>
                  )}
                </div>
              </div>

              {/* Room & Bed Availability Tonight */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold font-serif text-slate-900 text-base">Room & bed inventory tonight</h3>
                    <p className="text-[11px] text-slate-400">Live bed-level status across all 4 rooms (16 beds total)</p>
                  </div>
                  <div className="flex items-center space-x-3 text-[11px] text-slate-500 font-medium">
                    <span className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Free</span>
                    </span>
                    <span className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Booked</span>
                    </span>
                    <span className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#0d1726]" />
                      <span>Checked-in</span>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {HOSTEL_ROOMS.map(room => {
                    const activeInRoom = reservations.filter(
                      r => r.room.toLowerCase().includes(room.name.toLowerCase()) && r.status !== 'Cancelled'
                    );
                    const occupiedUnits = new Set(activeInRoom.map(r => r.unitId || r.bedCode));
                    const freeCount = Math.max(0, room.capacity - activeInRoom.length);

                    return (
                      <div key={room.id} className="bg-white rounded-xl border border-[#e8e4dc] p-4 shadow-2xs space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <h4 className="font-bold font-serif text-slate-900 text-sm">{room.name}</h4>
                              <span className="text-[10px] text-slate-400 font-mono">{room.roomCode}</span>
                              <span className="text-[10px] bg-amber-50 text-amber-800 font-semibold px-2 py-0.5 rounded-full border border-amber-200">
                                {freeCount} of {room.capacity} free
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">{room.type}</p>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-slate-900 font-serif text-sm">{formatMoney(room.rate)}</span>
                            <p className="text-[9px] text-slate-400">≈ TZS 52,900 / night</p>
                          </div>
                        </div>

                        {/* Units Grid */}
                        <div className="grid grid-cols-3 gap-2">
                          {room.units
                            .filter(u => u.capacity === 1)
                            .map(unit => {
                              const occupant = activeInRoom.find(r => (r.unitId || r.bedCode) === unit.id);
                              const isOccupied = Boolean(occupant);

                              return (
                                <div
                                  key={unit.id}
                                  className={`p-2 rounded-lg border flex flex-col justify-between text-[11px] ${
                                    isOccupied ? 'border-amber-300 bg-amber-50/50' : 'border-[#e8e4dc] bg-[#faf8f5]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono font-bold text-slate-800 text-[10px]">{unit.id}</span>
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        isOccupied
                                          ? occupant?.status.toLowerCase() === 'checked-in'
                                            ? 'bg-[#0d1726]'
                                            : 'bg-amber-500'
                                          : 'bg-emerald-500'
                                      }`}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between mt-1 text-[10px]">
                                    <span className="text-slate-400 truncate">{unit.place}</span>
                                    <span className={isOccupied ? 'font-bold text-amber-900 truncate' : 'text-slate-400'}>
                                      {occupant ? occupant.guestName.split(' ')[0] : 'Free'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#f1ede4] text-[11px]">
                          <span className="text-slate-400 font-mono">{room.capacity} beds total</span>
                          <button
                            onClick={() => handleOpenNewModal(`${room.name} (${room.roomCode})`)}
                            className="text-slate-700 hover:text-amber-800 font-semibold bg-[#faf8f5] hover:bg-slate-100 border border-[#e8e4dc] px-2.5 py-1 rounded-lg transition cursor-pointer"
                          >
                            + Book this room
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Outstanding Payments List */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-4 sm:p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#f1ede4]">
                  <div>
                    <h3 className="font-bold font-serif text-slate-900 text-sm sm:text-base">Outstanding balances</h3>
                    <p className="text-[11px] text-slate-500">
                      Folios pending collection upon check-in or stay completion
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-amber-900 font-mono">
                    {pendingPayments.length} pending
                  </span>
                </div>

                <div className="divide-y divide-[#f5f1e8]">
                  {pendingPayments.map(r => (
                    <div key={r.id} className="py-3 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 text-xs sm:text-sm">{r.guestName}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{r.id}</span>
                          <span className="text-[11px] font-mono text-slate-600 bg-[#f6f3ed] px-1.5 py-0.5 rounded border border-[#e8e4dc]">
                            {r.unitId || r.bedCode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Dates: {r.checkIn} – {r.checkOut} <span aria-hidden="true">·</span> Status: <span className="font-medium text-slate-700">{r.status}</span>
                        </p>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end space-x-4">
                        <div className="text-left sm:text-right">
                          <div className="font-bold font-serif text-amber-900 text-sm">{formatMoney(r.balanceDue)}</div>
                          <div className="text-[10px] text-slate-400 font-mono">≈ TZS {(r.balanceDue * 2645).toLocaleString()}</div>
                        </div>
                        <button
                          onClick={() => setCollectModalBooking(r)}
                          className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#e8e4dc] rounded-xl text-xs font-semibold shadow-2xs transition flex items-center space-x-1.5 cursor-pointer"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                          <span>Collect</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingPayments.length === 0 && (
                    <p className="text-xs text-slate-400 italic py-2">All reservation folios are fully settled.</p>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: BOOKINGS MASTER TABLE                             */}
          {/* ======================================================== */}
          {activeTab === 'bookings' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Bookings</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Search, filter, inspect guest folios, record payments, and manage check-ins synchronized directly with your Google Sheet.
                  </p>
                </div>
                <button
                  onClick={() => handleOpenNewModal()}
                  className="flex items-center space-x-1.5 bg-[#d99b26] hover:bg-[#c5891c] text-[#0d1726] font-bold text-xs px-4 py-2 rounded-xl shadow-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ New Booking</span>
                </button>
              </div>

              {/* Status Filter Segmented Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 sm:p-3 rounded-2xl border border-[#e8e4dc]">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#f5f2eb] rounded-xl">
                  {(['ALL', 'Confirmed', 'Checked-in', 'Checked-out', 'Tentative', 'Cancelled'] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                      }`}
                    >
                      {st === 'ALL' ? 'All Bookings' : st}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-slate-500 font-mono px-2">
                  Showing <strong>{filteredBookings.length}</strong> of {reservations.length} records
                </div>
              </div>

              {/* Bookings Table */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-[#f9f7f2] border-b border-[#e8e4dc] text-slate-400 font-semibold tracking-wider uppercase text-[10px]">
                      <tr>
                        <th className="py-3.5 px-5">Booking ID</th>
                        <th className="py-3.5 px-5">Guest</th>
                        <th className="py-3.5 px-5">Room & Unit</th>
                        <th className="py-3.5 px-5">Dates</th>
                        <th className="py-3.5 px-5">Status</th>
                        <th className="py-3.5 px-5">Balance Due</th>
                        <th className="py-3.5 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2ede4] font-medium text-slate-700">
                      {filteredBookings.map(r => (
                        <tr key={r.id} className="hover:bg-[#faf8f5] transition-colors">
                          <td className="py-3 px-5 font-mono font-bold text-slate-800">{r.id}</td>
                          <td className="py-3 px-5">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900">{r.guestName}</span>
                              {r.guestId && (
                                <span className="text-[10px] bg-slate-100 text-slate-600 font-mono px-1.5 py-0.5 rounded border border-slate-200">
                                  {r.guestId}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-2 mt-0.5">
                              <span>{r.phone || '—'}</span>
                              {r.email && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-500 lowercase">{r.email}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="font-semibold text-slate-800">{r.room}</div>
                            <div className="text-[11px] text-amber-900 font-mono font-bold">{r.unitId || r.bedCode}</div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="text-slate-800">{r.checkIn} – {r.checkOut}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{r.nights} nights</div>
                          </td>
                          <td className="py-3 px-5">
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                r.status.toLowerCase() === 'checked-in'
                                  ? 'text-emerald-800'
                                  : r.status.toLowerCase() === 'confirmed'
                                  ? 'text-blue-800'
                                  : r.status.toLowerCase() === 'cancelled'
                                  ? 'text-rose-700'
                                  : 'text-amber-800'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  r.status.toLowerCase() === 'checked-in'
                                    ? 'bg-emerald-600'
                                    : r.status.toLowerCase() === 'confirmed'
                                    ? 'bg-blue-600'
                                    : r.status.toLowerCase() === 'cancelled'
                                    ? 'bg-rose-600'
                                    : 'bg-amber-600'
                                }`}
                              />
                              <span>{r.status}</span>
                            </span>
                          </td>
                          <td className="py-3 px-5">
                            <div
                              className={`font-bold font-serif ${
                                r.balanceDue > 0 ? 'text-amber-800' : 'text-emerald-700'
                              }`}
                            >
                              {formatMoney(r.balanceDue)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              ≈ TZS {(r.balanceDue * 2645).toLocaleString()}
                            </div>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              onClick={() => handleOpenEditModal(r)}
                              className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-semibold transition cursor-pointer"
                            >
                              Edit / View
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredBookings.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                            No matching reservations found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3 bg-[#faf8f5] border-t border-[#e8e4dc] flex items-center justify-between text-xs text-slate-400">
                  <span>Connected Google Sheet Database: <strong className="text-slate-700 font-semibold">{selectedTabName}</strong></span>
                  <span className="font-mono text-[11px]">Last Sync: {lastSyncTime || 'Local mode'}</span>
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: AVAILABILITY TIMELINE                             */}
          {/* ======================================================== */}
          {activeTab === 'availability' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Availability</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Room timeline and occupancy calendar across all hostel rooms and beds. Click any date cell to book.
                  </p>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => {
                      const d = new Date(timelineAnchor);
                      d.setDate(d.getDate() - 7);
                      setTimelineAnchor(d);
                    }}
                    className="px-2.5 py-1 text-xs border border-[#e8e4dc] rounded-lg hover:bg-slate-50 text-slate-600 flex items-center space-x-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev 7d</span>
                  </button>
                  <button
                    onClick={() => setTimelineAnchor(new Date('2026-09-23'))}
                    className="px-3 py-1 text-xs bg-[#f6f3ed] border border-[#e8e4dc] rounded-lg font-semibold text-slate-800"
                  >
                    Today (Sep 2026)
                  </button>
                  <button
                    onClick={() => {
                      const d = new Date(timelineAnchor);
                      d.setDate(d.getDate() + 7);
                      setTimelineAnchor(d);
                    }}
                    className="px-2.5 py-1 text-xs border border-[#e8e4dc] rounded-lg hover:bg-slate-50 text-slate-600 flex items-center space-x-1"
                  >
                    <span>Next 7d</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 14-Day Timeline Matrix */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-5 shadow-2xs space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs border-collapse">
                    <thead>
                      <tr className="text-slate-500 text-[11px] border-b border-[#e8e4dc]">
                        <th className="py-2.5 px-4 text-left font-semibold uppercase text-[10px] text-slate-400 w-40">
                          Room
                        </th>
                        {Array.from({ length: 14 }).map((_, i) => {
                          const date = new Date(timelineAnchor);
                          date.setDate(date.getDate() + i);
                          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                          return (
                            <th key={i} className="py-2 px-2 text-center min-w-[50px]">
                              <span className="block text-[10px] text-slate-400 font-normal">
                                {dayNames[date.getDay()]}
                              </span>
                              <span className="block text-xs font-bold text-slate-800 font-mono">{date.getDate()}</span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2ede4]">
                      {HOSTEL_ROOMS.map(room => (
                        <tr key={room.id} className="hover:bg-[#faf8f5]">
                          <td className="py-3 px-4 text-left">
                            <span className="font-bold text-slate-900 block">{room.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {room.roomCode} • {room.capacity} beds
                            </span>
                          </td>
                          {Array.from({ length: 14 }).map((_, i) => {
                            const d = new Date(timelineAnchor);
                            d.setDate(d.getDate() + i);
                            const dateStr = d.toISOString().split('T')[0];

                            // Find all reservations occupying this room on this date
                            const activeReservationsOnDay: Reservation[] = [];
                            let bookedOnDay = 0;
                            reservations.forEach(r => {
                              if (
                                r.room.toLowerCase().includes(room.name.toLowerCase()) &&
                                dateStr >= r.checkIn &&
                                dateStr < r.checkOut &&
                                r.status !== 'Cancelled'
                              ) {
                                activeReservationsOnDay.push(r);
                                bookedOnDay += r.bedsCount || 1;
                              }
                            });

                            const free = Math.max(0, room.capacity - bookedOnDay);
                            let cellStyle = 'bg-white text-slate-600 hover:bg-emerald-50/60';
                            let content = <span className="text-emerald-700 font-bold font-mono">{room.capacity}</span>;

                            if (bookedOnDay >= room.capacity) {
                              cellStyle = 'bg-[#ebd095] text-amber-950 font-bold border border-[#cca55e] hover:bg-[#e4c47f]';
                              content = (
                                <div>
                                  <div className="font-mono">{bookedOnDay}b</div>
                                  <div className="text-[9px] text-amber-900">Full</div>
                                </div>
                              );
                            } else if (bookedOnDay > 0) {
                              cellStyle = 'bg-[#fdf2da] text-amber-900 border border-[#f5dfb3] hover:bg-[#fae7c2]';
                              content = (
                                <div>
                                  <div className="font-mono font-bold">{bookedOnDay}b</div>
                                  <div className="text-[9px] text-slate-500">{free} free</div>
                                </div>
                              );
                            }

                            return (
                              <td
                                key={i}
                                onClick={() => {
                                  if (activeReservationsOnDay.length > 0) {
                                    // When a room is booked on this date, display the booking information modal
                                    setSelectedBookingInfo({
                                      roomName: `${room.name} (${room.roomCode})`,
                                      dateStr: dateStr,
                                      bookings: activeReservationsOnDay
                                    });
                                  } else {
                                    // Free date: open new booking prefilled with this room and date
                                    handleOpenNewModal(`${room.name} (${room.roomCode})`, dateStr);
                                  }
                                }}
                                className={`py-2 px-1 text-center cursor-pointer transition select-none ${cellStyle}`}
                                title={
                                  activeReservationsOnDay.length > 0
                                    ? `Click to view and change booking details for ${room.name} on ${dateStr}`
                                    : `Click to book ${room.name} on ${dateStr}`
                                }
                              >
                                {content}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Legend */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[#f1ede4] text-[11px] text-slate-400">
                  <div className="flex items-center space-x-3">
                    <span className="flex items-center space-x-1.5">
                      <span className="w-3 h-3 bg-white border border-[#e8e4dc] rounded-xs" />
                      <span>All beds free</span>
                    </span>
                    <span className="flex items-center space-x-1.5">
                      <span className="w-3 h-3 bg-[#fdf2da] border border-[#f5dfb3] rounded-xs" />
                      <span>Partially booked</span>
                    </span>
                    <span className="flex items-center space-x-1.5">
                      <span className="w-3 h-3 bg-[#ebd095] border border-[#cca55e] rounded-xs" />
                      <span>Full (0 free)</span>
                    </span>
                  </div>
                  <div className="font-medium text-slate-500">
                    Rates: <span className="font-bold text-slate-800">TZS 52,900 (≈ $20)</span> per bed / night
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: ROOMS & UNITS                                     */}
          {/* ======================================================== */}
          {activeTab === 'rooms' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div>
                <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Rooms & Units</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hostel room inventory breakdown with official bed identifiers matching your Moshi Urban spreadsheet setup.
                </p>
              </div>

              <div className="space-y-4">
                {HOSTEL_ROOMS.map(room => (
                  <div key={room.id} className="bg-white rounded-2xl border border-[#e8e4dc] p-5 shadow-2xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-bold font-serif text-slate-900 text-base">{room.name}</h3>
                          <span className="text-xs text-slate-400 font-mono">{room.roomCode}</span>
                          <span className="text-xs text-slate-500 font-medium">
                            <span aria-hidden="true">·</span> {room.capacity} beds capacity
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{room.description}</p>
                      </div>

                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <span className="font-bold font-serif text-slate-900 text-lg">{formatMoney(room.rate)}</span>
                          <p className="text-[10px] text-slate-400">≈ TZS 52,900 / night</p>
                        </div>
                        <button
                          onClick={() => handleOpenNewModal(`${room.name} (${room.roomCode})`)}
                          className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#e8e4dc] rounded-xl text-xs font-semibold shadow-2xs transition cursor-pointer"
                        >
                          + Book this room
                        </button>
                      </div>
                    </div>

                    {/* Official Unit IDs Tag Breakdown */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-slate-400 font-medium">Assigned Bed Codes:</span>
                      {room.units.map(u => (
                        <span
                          key={u.id}
                          className="px-2.5 py-1 rounded-lg bg-[#faf8f5] border border-[#e8e4dc] text-xs font-mono text-slate-800"
                        >
                          <strong className="text-amber-900">{u.id}</strong>{' '}
                          <span className="text-slate-400">({u.place})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 5: SPREADSHEET DATABASE (DIRECT GOOGLE CONNECTION)   */}
          {/* ======================================================== */}
          {activeTab === 'sheets' && (
            <div className="space-y-6 animate-in fade-in duration-150 max-w-4xl">
              <div>
                <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">
                  Google Sheets Database Connection
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Direct two-way connection to your Moshi Urban Hostel booking spreadsheet stored in your Google Drive.
                </p>
              </div>

              {/* Account Connection Card */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-6 shadow-2xs space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 font-serif">Google Workspace Account</h3>
                      <p className="text-xs text-slate-400">
                        {user
                          ? `Authenticated as ${user.displayName || user.email}`
                          : 'Connect your Google account to grant permission to read and update your booking sheet.'}
                      </p>
                    </div>
                  </div>

                  <div>
                    {user ? (
                      <button
                        onClick={handleSignOut}
                        className="px-3.5 py-1.5 border border-slate-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-xl transition cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={handleSignIn}
                        disabled={isSigningIn}
                        className="px-4 py-2 bg-[#d99b26] hover:bg-[#c5891c] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-2 cursor-pointer"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>Sign in with Google</span>
                      </button>
                    )}
                  </div>
                </div>

                {user && (
                  <div className="space-y-5 pt-4 border-t border-[#f1ede4]">
                    
                    {/* Method 1: Dropdown Selection */}
                    <div className="bg-[#faf8f5] p-4 rounded-xl border border-[#ede9e1] space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-slate-800">
                          1. Choose from Google Drive spreadsheets:
                        </label>
                        <button
                          onClick={() => {
                            if (token) loadSpreadsheets(token);
                            else triggerToast('Please sign in first', 'error');
                          }}
                          disabled={isLoadingSheets}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-[#e8e4dc] px-2.5 py-1 rounded-lg transition flex items-center space-x-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 ${isLoadingSheets ? 'animate-spin' : ''}`} />
                          <span>{isLoadingSheets ? 'Refreshing...' : 'Refresh List'}</span>
                        </button>
                      </div>

                      {isLoadingSheets ? (
                        <div className="py-3 text-center text-xs text-slate-500 font-medium">
                          Searching your Google Drive for spreadsheets...
                        </div>
                      ) : (
                        <select
                          value={selectedSheetId}
                          onChange={e => {
                            const id = e.target.value;
                            setSelectedSheetId(id);
                            const matched = sheetsList.find(f => f.id === id);
                            if (matched) {
                              setSelectedSheetName(matched.name);
                              setManualSheetInput(id);
                              localStorage.setItem('muh_active_sheet_id', id);
                              localStorage.setItem('muh_active_sheet_name', matched.name);
                            }
                            if (token && id) loadSheetTabs(id, token);
                          }}
                          className="w-full bg-white border border-[#e8e4dc] text-xs font-medium rounded-xl px-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                        >
                          <option value="">
                            {sheetsList.length === 0
                              ? '-- No spreadsheets found automatically (use option 2 below) --'
                              : '-- Select a spreadsheet from your Drive --'}
                          </option>
                          {sheetsList.map(f => (
                            <option key={f.id} value={f.id}>
                              {f.name} (Modified: {new Date(f.modifiedTime).toLocaleDateString()})
                            </option>
                          ))}
                        </select>
                      )}

                      {sheetsList.length === 0 && !isLoadingSheets && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                          Drive file listing didn't return any spreadsheets directly. If your sheet is stored in a subfolder or shared drive, use <strong>Option 2</strong> below to paste the link directly.
                        </p>
                      )}
                    </div>

                    {/* Method 2: Direct Google Sheet Link or ID (100% Reliable Direct Access) */}
                    <div className="bg-[#faf8f5] p-4 rounded-xl border border-[#ede9e1] space-y-2">
                      <label className="block text-xs font-bold text-slate-800">
                        2. Or connect directly via Google Sheet Link / ID:
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Copy the link from your browser URL bar (e.g. <code>https://docs.google.com/spreadsheets/d/1BxiM.../edit</code>) and paste it here:
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={manualSheetInput}
                            onChange={e => setManualSheetInput(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            className="w-full bg-white border border-[#e8e4dc] text-xs font-mono rounded-xl pl-8 pr-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                          />
                          <LinkIcon className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
                        </div>
                        <button
                          onClick={() => handleConnectManualSheet()}
                          disabled={isLoadingSheets}
                          className="px-4 py-2.5 bg-[#0d1726] hover:bg-[#1b2b45] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5 text-[#d99b26]" />
                          <span>Connect Sheet</span>
                        </button>
                      </div>
                    </div>

                    {/* Active Selected Sheet Banner */}
                    {selectedSheetId && (
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div>
                            <span className="font-bold text-emerald-950">Active Sheet:</span>{' '}
                            <span className="text-emerald-900 font-medium">
                              {selectedSheetName || selectedSheetId}
                            </span>
                            <span className="block text-[10px] text-emerald-700 font-mono">
                              ID: {selectedSheetId}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${selectedSheetId}/edit`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 flex items-center space-x-1 underline"
                        >
                          <span>Open in Google Sheets</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {/* Sheet Tabs */}
                    {availableTabs.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-700">
                          Select Sheet Tab to read & write bookings:
                        </label>
                        <select
                          value={selectedTabName}
                          onChange={e => {
                            setSelectedTabName(e.target.value);
                            localStorage.setItem('muh_active_tab_name', e.target.value);
                          }}
                          className="w-full bg-[#faf8f5] border border-[#e8e4dc] text-xs font-medium rounded-xl px-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                        >
                          {availableTabs.map(t => (
                            <option key={t} value={t}>
                              Tab: {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {sheetsLoadError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start justify-between gap-3">
                        <div className="flex items-start space-x-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                          <div>
                            <strong>Notice:</strong> {sheetsLoadError}
                          </div>
                        </div>
                        {sheetsLoadError.toLowerCase().includes('sign in') && (
                          <button
                            onClick={handleSignIn}
                            disabled={isSigningIn}
                            className="shrink-0 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] rounded-lg transition shadow-xs cursor-pointer"
                          >
                            {isSigningIn ? 'Signing in...' : 'Sign In Again'}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        onClick={() => syncFromGoogleSheet()}
                        disabled={isSyncing || !selectedSheetId}
                        className="px-4 py-2 bg-[#d99b26] hover:bg-[#c5891c] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>Pull from Google Sheet Now</span>
                      </button>
                      <button
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: 'Sync All to Google Sheet',
                            message: `Append ${reservations.length} records to your Google Sheet tab "${selectedTabName}"?`,
                            onConfirm: async () => {
                              setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              for (const r of reservations) {
                                await saveReservationToSheet(r, true);
                              }
                              triggerToast('All reservations synced with Google Sheet!', 'success');
                            }
                          });
                        }}
                        disabled={!selectedSheetId}
                        className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
                      >
                        Push All Current GUI Records to Sheet
                      </button>
                    </div>

                    {syncMessage && (
                      <p className="text-xs text-slate-500 pt-1 flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
                        <span>{syncMessage}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Explanation of Direct 2-Way Architecture */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-6 shadow-2xs space-y-3">
                <h3 className="font-bold text-sm text-slate-900 font-serif">
                  Why this directly solves your previous synchronization problems:
                </h3>
                <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4 leading-relaxed">
                  <li>
                    <strong>No reliance on brittle external Apps Script web URLs:</strong> Previous attempts required
                    deploying Apps Script with custom JSON parsing that often fails on CORS or permissions. This app now
                    communicates directly with the official Google Sheets & Drive REST APIs via your authenticated Google
                    account.
                  </li>
                  <li>
                    <strong>Automatic Column Header Detection:</strong> Whether your sheet labels the column "Booking ID",
                    "ID", "Guest name", or "Check-in", the parser automatically maps every cell accurately.
                  </li>
                  <li>
                    <strong>Direct Two-Way Writes:</strong> Whenever you create a reservation or check in a guest in this
                    GUI, it immediately issues a Google Sheets API update to synchronize your live spreadsheet.
                  </li>
                </ul>
              </div>

            </div>
          )}

        </main>

        {/* Global Hostel Footer */}
        <footer className="mt-auto bg-white border-t border-[#e8e4dc] py-4 px-8 select-none">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Moshi Urban Horizontal Brand Logo */}
            <div className="flex items-center space-x-4">
              <img
                src="/moshi_urban_logo_horizontal.svg"
                alt="Moshi Urban Hostel & Backpackers"
                className="h-12 w-auto object-contain"
              />
              <div className="hidden lg:block border-l border-slate-200 pl-4 py-0.5">
                <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 block">
                  Property Management System
                </span>
                <span className="text-[10px] text-slate-500">Moshi, Kilimanjaro, Tanzania</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-500">
              <span className="flex items-center space-x-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>+255 715 777 354</span>
              </span>
              <a
                href="mailto:info@moshiurban.co.tz"
                className="hover:text-[#d99b26] transition"
              >
                info@moshiurban.co.tz
              </a>
              <a
                href="https://moshiurban.co.tz"
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-1 text-slate-700 hover:text-[#d99b26] font-medium transition"
              >
                <span>moshiurban.co.tz</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            </div>
          </div>
        </footer>

      </div>

      {/* CREATE / EDIT RESERVATION MODAL */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#e8e4dc] my-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1ede4]">
              <div>
                <h3 className="text-base font-bold font-serif text-slate-900">
                  {editingBooking ? `Edit Reservation (${formData.id})` : 'New Reservation'}
                </h3>
                <p className="text-xs text-slate-400">Writes directly to your Google Spreadsheet database</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="mt-4 space-y-4 text-xs">
              {/* Guest Name & Guest ID */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Guest Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.guestName}
                    onChange={e => setFormData(prev => ({ ...prev, guestName: e.target.value }))}
                    placeholder="e.g. Godwin Njau"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Guest ID</label>
                  <input
                    type="text"
                    value={formData.guestId}
                    onChange={e => setFormData(prev => ({ ...prev, guestId: e.target.value }))}
                    placeholder="e.g. GS-0008"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-mono font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="e.g. guest@example.com"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="e.g. 255756200540"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
              </div>

              {/* Room & Bed Code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Room Category *</label>
                  <select
                    value={formData.room}
                    onChange={e => {
                      const roomName = e.target.value;
                      const roomObj = HOSTEL_ROOMS.find(r => roomName.includes(r.name));
                      const defaultBed = roomObj?.units[0]?.id || 'M-S1';
                      setFormData(prev => ({
                        ...prev,
                        room: roomName,
                        bedCode: defaultBed
                      }));
                    }}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  >
                    <option value="Mawenzi (Room 1)">Mawenzi (Room 1) • 3 Beds</option>
                    <option value="Njoro (Room 2)">Njoro (Room 2) • 6 Beds</option>
                    <option value="Bondeni (Room 3)">Bondeni (Room 3) • 4 Beds</option>
                    <option value="Soweto (Room 4)">Soweto (Room 4) • 3 Beds</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned Bed Code *</label>
                  <select
                    value={formData.bedCode}
                    onChange={e => setFormData(prev => ({ ...prev, bedCode: e.target.value }))}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  >
                    {HOSTEL_ROOMS.find(r => formData.room.includes(r.name))?.units.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.id} — {u.place}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Check-in *</label>
                  <input
                    type="date"
                    required
                    value={formData.checkIn}
                    onChange={e => handleDateChange(e.target.value, formData.checkOut)}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Check-out *</label>
                  <input
                    type="date"
                    required
                    value={formData.checkOut}
                    onChange={e => handleDateChange(formData.checkIn, e.target.value)}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nights</label>
                  <input
                    type="number"
                    readOnly
                    value={formData.nights}
                    className="w-full bg-slate-100 border border-[#e8e4dc] rounded-xl px-3 py-2 font-bold text-slate-700"
                  />
                </div>
              </div>

              {/* Total & Paid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Total (USD $)</label>
                  <input
                    type="number"
                    value={formData.totalAmount}
                    onChange={e => {
                      const total = Number(e.target.value) || 0;
                      setFormData(prev => ({
                        ...prev,
                        totalAmount: total,
                        balanceDue: Math.max(0, total - prev.paidAmount)
                      }));
                    }}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Paid (USD $)</label>
                  <input
                    type="number"
                    value={formData.paidAmount}
                    onChange={e => {
                      const paid = Number(e.target.value) || 0;
                      setFormData(prev => ({
                        ...prev,
                        paidAmount: paid,
                        balanceDue: Math.max(0, prev.totalAmount - paid)
                      }));
                    }}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Balance Due</label>
                  <input
                    type="number"
                    readOnly
                    value={formData.balanceDue}
                    className="w-full bg-rose-50 border border-rose-200 text-rose-800 font-bold rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              {/* Status, Platform, Currency & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  >
                    <option value="Confirmed">Confirmed</option>
                    <option value="Checked-in">Checked-in</option>
                    <option value="Checked-out">Checked-out</option>
                    <option value="Tentative">Tentative</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Platform / Source</label>
                  <select
                    value={formData.platform}
                    onChange={e => setFormData(prev => ({ ...prev, platform: e.target.value }))}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  >
                    <option value="Direct Booking">Direct Booking</option>
                    <option value="Website">Website</option>
                    <option value="Airbnb">Airbnb</option>
                    <option value="Booking.com">Booking.com</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Currency</label>
                  <select
                    value={formData.currency}
                    onChange={e => setFormData(prev => ({ ...prev, currency: e.target.value as 'TZS' | 'USD' }))}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="TZS">TZS (Shillings)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes / Requests / Airport Pickup</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="e.g. Needs airport pickup, climbing Kilimanjaro"
                  className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#d99b26]"
                />
              </div>

              {/* Form Actions */}
              <div className="pt-4 border-t border-[#f1ede4] flex items-center justify-between">
                {editingBooking ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteBooking(editingBooking.id)}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-2 rounded-xl transition cursor-pointer"
                  >
                    Delete Record
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsBookingModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="px-5 py-2 text-xs font-bold text-[#0d1726] bg-[#d99b26] hover:bg-[#c5891c] rounded-xl shadow-xs transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    {isSyncing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isSyncing ? 'Syncing...' : 'Save & Sync to Sheet'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK COLLECT PAYMENT MODAL */}
      {collectModalBooking && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-[#e8e4dc] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-3 mb-3">
              <div className="p-2.5 bg-amber-50 rounded-xl text-[#d99b26]">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold font-serif text-slate-900 text-sm">Collect Balance</h4>
                <p className="text-xs text-slate-500">
                  {collectModalBooking.guestName} ({collectModalBooking.id})
                </p>
              </div>
            </div>

            <div className="bg-[#faf8f5] p-3 rounded-xl border border-[#ede9e1] my-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Outstanding Balance:</span>
                <span className="font-bold text-rose-600">${collectModalBooking.balanceDue}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tanzanian Shilling (TZS):</span>
                <span className="font-mono font-medium text-slate-700">
                  ≈ TZS {(collectModalBooking.balanceDue * 2645).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setCollectModalBooking(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCollect}
                className="px-4 py-1.5 text-xs font-bold text-[#0d1726] bg-[#d99b26] hover:bg-[#c5891c] rounded-xl shadow-xs cursor-pointer"
              >
                Mark Paid Full & Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AVAILABILITY: BOOKED DATE DETAILS POPOVER MODAL */}
      {selectedBookingInfo && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#e8e4dc] my-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1ede4]">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <h3 className="text-base font-bold font-serif text-slate-900">
                    {selectedBookingInfo.roomName}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Booked on <span className="font-bold text-slate-800 font-mono">{selectedBookingInfo.dateStr}</span> ({selectedBookingInfo.bookings.length} {selectedBookingInfo.bookings.length === 1 ? 'booking' : 'bookings'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBookingInfo(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {selectedBookingInfo.bookings.map(b => (
                <div
                  key={b.id}
                  className="p-4 rounded-xl border border-[#e8e4dc] bg-[#faf8f5] hover:bg-white transition space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900 text-sm">{b.guestName}</span>
                        {b.guestId && (
                          <span className="text-[10px] bg-slate-200/70 text-slate-700 font-mono px-1.5 py-0.5 rounded font-semibold">
                            {b.guestId}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        Booking ID: <strong className="text-slate-800">{b.id}</strong>
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        b.status.toLowerCase() === 'checked-in'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : b.status.toLowerCase() === 'confirmed'
                          ? 'bg-blue-50 text-blue-800 border border-blue-200'
                          : b.status.toLowerCase() === 'cancelled'
                          ? 'bg-rose-50 text-rose-800 border border-rose-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>

                  {/* Grid details */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded-lg border border-[#f1ede4]">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Assigned Unit</span>
                      <span className="font-mono font-bold text-amber-900">{b.unitId || b.bedCode}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Stay Dates</span>
                      <span className="font-medium text-slate-800">{b.checkIn} &rarr; {b.checkOut} ({b.nights}n)</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Phone Number</span>
                      <span className="font-mono text-slate-700">{b.phone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Email Address</span>
                      <span className="text-slate-700 truncate block">{b.email || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Platform / Source</span>
                      <span className="text-slate-700">{b.platform || 'Direct Booking'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Balance Due</span>
                      <span className={`font-bold ${b.balanceDue > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                        ${b.balanceDue} ({b.currency || 'USD'})
                      </span>
                    </div>
                  </div>

                  {b.notes && (
                    <div className="text-xs text-slate-600 bg-amber-50/50 p-2.5 rounded-lg border border-amber-200/60">
                      <strong className="text-amber-900 block text-[10px] uppercase">Notes / Requests:</strong>
                      <span>{b.notes}</span>
                    </div>
                  )}

                  {/* Action button to change booking details */}
                  <div className="pt-2 flex items-center justify-between border-t border-[#ede9e1]">
                    <span className="text-[11px] text-slate-400">
                      Changes synchronize with Google Sheets
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBookingInfo(null);
                        handleOpenEditModal(b);
                      }}
                      className="px-3.5 py-1.5 bg-[#d99b26] hover:bg-[#c5891c] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>Change Booking Details</span>
                      <span>&rarr;</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-3 border-t border-[#f1ede4] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const room = selectedBookingInfo.roomName;
                  const date = selectedBookingInfo.dateStr;
                  setSelectedBookingInfo(null);
                  handleOpenNewModal(room, date);
                }}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
              >
                + Add Another Booking on this Date
              </button>
              <button
                type="button"
                onClick={() => setSelectedBookingInfo(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

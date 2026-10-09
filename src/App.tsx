import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  clearAccessToken
} from './auth';
import {
  auth as firebaseAuth,
  testFirestoreConnection,
  saveReservationToFirestore,
  deleteReservationFromFirestore,
  clearAllReservationsFromFirestore,
  subscribeToReservations,
  fetchReservationsFromFirestore
} from './firebase';
import {
  listUserSpreadsheets,
  getSpreadsheetDetails,
  readSheetRows,
  parseSheetToReservations,
  appendReservationToSheet,
  updateReservationInSheet,
  deleteReservationFromSheet,
  deleteBatchReservationsFromSheet,
  clearAllBookingsFromSheet,
  validateSpreadsheetById,
  formatA1Range,
  generateGuestId,
  calculateRoomBedAvailability,
  detectMissingGuestIdsInRows,
  writeMissingGuestIdsToSheet,
  setupSheetAutomations,
  GOOGLE_APPS_SCRIPT_CODE,
  SheetFile,
  fixSheetRefErrors,
  runBidirectionalSyncTest,
  SyncTestReport,
  SyncTestStepResult,
  SheetRepairResult
} from './sheetsService';
import {
  HOSTEL_ROOMS,
  INITIAL_RESERVATIONS,
  Reservation,
  HostelRoom,
  ChangeLogEntry
} from './types';
import {
  Calendar,
  Bed,
  Users,
  Database,
  Cloud,
  Flame,
  DollarSign,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  LogIn,
  CheckCircle2,
  CheckCircle,
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
  Menu,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  MinusSquare,
  SlidersHorizontal,
  Download,
  ChevronDown,
  Filter,
  Code,
  Copy,
  Dices,
  Zap,
  History,
  Undo2,
  RotateCcw,
  Clock,
  CalendarDays,
  Edit3,
  Wrench,
  PlayCircle,
  Activity
} from 'lucide-react';

export type SortField = 'checkIn' | 'checkOut' | 'guestName' | 'id' | 'room' | 'status' | 'balanceDue' | 'totalAmount';
export type SortDirection = 'asc' | 'desc';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'availability' | 'rooms' | 'sheets' | 'changelog'>('overview');

  // Reservations Data (Starts completely clean & fresh)
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    const freshStartClean = localStorage.getItem('muh_fresh_start_clean_v1');
    if (!freshStartClean) {
      localStorage.setItem('muh_fresh_start_clean_v1', 'true');
      localStorage.setItem('muh_reservations_db', '[]');
      return [];
    }
    const saved = localStorage.getItem('muh_reservations_db');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  // Undo Stack State
  const [undoStack, setUndoStack] = useState<{
    id: string;
    actionName: string;
    previousReservations: Reservation[];
    timestamp: Date;
  }[]>([]);

  // Change Log History State (Persistent past 3 days)
  const [changeLogs, setChangeLogs] = useState<ChangeLogEntry[]>(() => {
    const saved = localStorage.getItem('muh_changelog_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return [
      {
        id: 'cl-1',
        action: 'check_in',
        title: 'Guest Checked In: Sarah Jenkins',
        description: 'Checked into Mawenzi (Room 1) • Bed M-B1L. Key handed over for 4-night stay.',
        targetId: 'MU-2',
        guestName: 'Sarah Jenkins',
        timestamp: '2026-10-08T08:15:00Z',
        user: 'Front Desk Operator',
        diffSummary: 'Status: Confirmed → Checked-in'
      },
      {
        id: 'cl-2',
        action: 'check_out',
        title: 'Guest Checked Out: Brian Kimario',
        description: 'Departed from Njoro (Room 2) • Bed N-B1U. Zero balance due. Linens queued for housekeeping.',
        targetId: 'MU-5',
        guestName: 'Brian Kimario',
        timestamp: '2026-10-08T07:20:00Z',
        user: 'Front Desk Operator',
        diffSummary: 'Status: Checked-in → Checked-out'
      },
      {
        id: 'cl-3',
        action: 'sync',
        title: 'Direct Google Sheets Synchronization',
        description: 'Synchronized reservations with active Google Spreadsheet tab "Booking overview".',
        timestamp: '2026-10-08T06:05:00Z',
        user: 'System Auto-Sync'
      },
      {
        id: 'cl-4',
        action: 'create',
        title: 'New Booking Created: Elena Rostova',
        description: 'Booked Njoro (Room 2) • Bed N-B1L for 6 nights (Oct 8 – Oct 14). Total $120 via Hostelworld.',
        targetId: 'MU-4',
        guestName: 'Elena Rostova',
        timestamp: '2026-10-07T16:45:00Z',
        user: 'Godwin (Hostel Manager)',
        diffSummary: 'Created MU-4 • Auto Guest ID ER-6204'
      },
      {
        id: 'cl-5',
        action: 'payment',
        title: 'Payment Recorded: Godwin Njau',
        description: 'Received $80 full payment for 4 nights stay in Mawenzi (Room 1).',
        targetId: 'MU-1',
        guestName: 'Godwin Njau',
        timestamp: '2026-10-07T11:30:00Z',
        user: 'Front Desk Staff',
        diffSummary: 'Paid: $40 → $80 (Balance: $0)'
      },
      {
        id: 'cl-6',
        action: 'create',
        title: 'New Booking Created: Lucas Moreau',
        description: 'Booked Soweto (Room 4) • Bed S-S1 for 3 nights (Oct 8 – Oct 11). Direct booking.',
        targetId: 'MU-6',
        guestName: 'Lucas Moreau',
        timestamp: '2026-10-06T19:10:00Z',
        user: 'Godwin (Hostel Manager)',
        diffSummary: 'Created MU-6 • Auto Guest ID LM-5519'
      },
      {
        id: 'cl-7',
        action: 'update',
        title: 'Updated Notes: Dominic Shoo',
        description: 'Added mountain trek logistics notes and dietary preferences.',
        targetId: 'MU-3',
        guestName: 'Dominic Shoo',
        timestamp: '2026-10-06T14:22:00Z',
        user: 'Front Desk Staff'
      }
    ];
  });
  const [changeLogFilter, setChangeLogFilter] = useState<'all' | 'today' | 'yesterday' | 'older'>('all');

  // Helper to log changes to Change Log
  const recordChange = (
    action: ChangeLogEntry['action'],
    title: string,
    description: string,
    targetId?: string,
    guestName?: string,
    diffSummary?: string,
    snapshotBefore?: Reservation[]
  ) => {
    const newEntry: ChangeLogEntry = {
      id: `cl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      action,
      title,
      description,
      targetId,
      guestName,
      timestamp: new Date().toISOString(),
      user: user?.displayName || 'Front Desk Staff',
      diffSummary,
      snapshotBefore: snapshotBefore ? JSON.parse(JSON.stringify(snapshotBefore)) : undefined
    };
    setChangeLogs(prev => [newEntry, ...prev]);
  };

  // Helper to push to undo stack
  const pushUndo = (actionName: string, stateToRestore: Reservation[]) => {
    setUndoStack(prev => [
      ...prev.slice(-30),
      {
        id: `undo-${Date.now()}`,
        actionName,
        previousReservations: JSON.parse(JSON.stringify(stateToRestore)),
        timestamp: new Date()
      }
    ]);
  };

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

  // Sorting & Batch Selection state for Bookings
  const [sortField, setSortField] = useState<SortField>('checkIn');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(true);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [showBatchStatusMenu, setShowBatchStatusMenu] = useState<boolean>(false);
  const [showCustomSelectMenu, setShowCustomSelectMenu] = useState<boolean>(false);

  // Firebase Firestore Status State
  const [firestoreConnected, setFirestoreConnected] = useState<boolean | null>(null);
  const [isFirebaseSyncing, setIsFirebaseSyncing] = useState<boolean>(false);

  // Availability calendar state (Automatically defaults to current date)
  const [calendarView, setCalendarView] = useState<'month' | 'day' | 'timeline'>('month');
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());
  const [timelineAnchor, setTimelineAnchor] = useState<Date>(new Date());

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

  // Auto-Sync Background Interval State
  const [autoSyncInterval, setAutoSyncInterval] = useState<'off' | '15' | '30' | '60'>(() => {
    return (localStorage.getItem('muh_auto_sync_interval') as any) || '30';
  });
  const [autoSyncSecondsLeft, setAutoSyncSecondsLeft] = useState<number>(30);
  const [isAutomationsModalOpen, setIsAutomationsModalOpen] = useState(false);
  const [automationsTab, setAutomationsTab] = useState<'setup' | 'script' | 'audit'>('setup');
  const [isConfiguringAutomations, setIsConfiguringAutomations] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Bidirectional Sync Test & #REF! Repair State
  const [isSyncTestModalOpen, setIsSyncTestModalOpen] = useState(false);
  const [isTestingSync, setIsTestingSync] = useState(false);
  const [syncTestReport, setSyncTestReport] = useState<SyncTestReport | null>(null);
  const [testStepsProgress, setTestStepsProgress] = useState<SyncTestStepResult[]>([]);
  const [isFixingRefErrors, setIsFixingRefErrors] = useState(false);
  const [sheetRepairStats, setSheetRepairStats] = useState<SheetRepairResult | null>(null);

  // New/Edit Reservation Form State: defaults checkIn to the current day!
  const todayStrInitial = new Date().toISOString().split('T')[0];
  const initialNextDate = new Date();
  initialNextDate.setDate(initialNextDate.getDate() + 3);
  const initialNextStr = initialNextDate.toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    id: '',
    guestId: '',
    guestName: '',
    email: '',
    phone: '',
    room: 'Mawenzi (Room 1)',
    bedCode: 'M-S1',
    checkIn: todayStrInitial,
    checkOut: initialNextStr,
    nights: 3,
    totalAmount: 60,
    paidAmount: 0,
    balanceDue: 60,
    status: 'Confirmed',
    notes: '',
    platform: 'Direct Booking',
    currency: 'USD'
  });

  // Calculate live room and bed availability dynamically for the form's active dates
  const modalAvailability = useMemo(() => {
    return calculateRoomBedAvailability(
      reservations,
      formData.checkIn,
      formData.checkOut,
      editingBooking?.id
    );
  }, [reservations, formData.checkIn, formData.checkOut, editingBooking]);

  // Save to LocalStorage whenever reservations change
  useEffect(() => {
    localStorage.setItem('muh_reservations_db', JSON.stringify(reservations));
  }, [reservations]);

  // Save Change Logs to LocalStorage
  useEffect(() => {
    localStorage.setItem('muh_changelog_history', JSON.stringify(changeLogs));
  }, [changeLogs]);

  // Global Undo Handler (Ctrl+Z or Undo button)
  const handleUndo = async () => {
    if (undoStack.length === 0) {
      triggerToast('No recent actions to undo', 'info');
      return;
    }
    const lastAction = undoStack[undoStack.length - 1];
    const previousState = lastAction.previousReservations;
    setUndoStack(prev => prev.slice(0, prev.length - 1));

    // Restore bookings state
    setReservations(previousState);

    // Record the undo action in the change log
    recordChange(
      'revert',
      `Undid: ${lastAction.actionName}`,
      `Restored hostel bookings back to state prior to "${lastAction.actionName}".`,
      undefined,
      undefined,
      `Reverted action`
    );

    triggerToast(`Undid "${lastAction.actionName}"!`, 'success');
  };

  // Keyboard shortcut Ctrl+Z / Cmd+Z for Undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack]);

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

  // Validate Firestore Connection on boot & Subscribe to real-time reservations
  useEffect(() => {
    testFirestoreConnection().then(connected => {
      setFirestoreConnected(connected);
      if (connected) {
        // If initial clean-slate boot, purge old leftover mock docs from Firestore
        if (!localStorage.getItem('muh_firestore_cleaned_v1')) {
          localStorage.setItem('muh_firestore_cleaned_v1', 'true');
          clearAllReservationsFromFirestore().catch(() => {});
        } else {
          // Try initial pull from Firestore
          fetchReservationsFromFirestore().then(list => {
            if (list) {
              setReservations(list);
            }
          }).catch(err => {
            console.warn('Initial Firestore fetch note:', err);
          });
        }

        // Set up real-time onSnapshot listener
        const unsub = subscribeToReservations(
          (liveReservations) => {
            setReservations(liveReservations || []);
          },
          (err) => {
            console.warn('Real-time reservations sync note:', err);
          }
        );
        return () => unsub();
      }
    });
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

  // Pull data from Google Sheet with automatic Guest ID backfill & bidirectional sync
  const bookingMutationVersion = useRef(0);
  const bookingMutationActive = useRef(false);

  const syncFromGoogleSheet = async (
    sheetId = selectedSheetId,
    tabName = selectedTabName,
    _activeAccessToken?: string | null,
    isQuiet = false
  ) => {
    if (bookingMutationActive.current) return;
    const startedAtVersion = bookingMutationVersion.current;
    if (!sheetId) {
      if (!isQuiet) triggerToast('Please select a spreadsheet to synchronize.', 'info');
      return;
    }

    // Always validate token freshness with getAccessToken()
    const currentToken = await getAccessToken();
    if (!currentToken) {
      clearAccessToken();
      setToken(null);
      setSyncStatus('idle');
      setSyncMessage('Google authorization expired. Please click "Sign in with Google" to connect your spreadsheet.');
      if (!isQuiet) {
        triggerToast('Please sign in to Google to sync with your spreadsheet.', 'info');
        setActiveTab('sheets');
      }
      return;
    }

    if (!isQuiet) {
      setIsSyncing(true);
      setSyncStatus('syncing');
      setSyncMessage(`Synchronizing with "${tabName}"...`);
    }

    try {
      const range = formatA1Range(tabName);
      const rows = await readSheetRows(sheetId, range, currentToken);
      if (bookingMutationActive.current || startedAtVersion !== bookingMutationVersion.current) return;

      // Detect and backfill any missing Guest IDs in Google Sheet automatically
      const missingGuestIdRows = detectMissingGuestIdsInRows(rows);
      if (missingGuestIdRows.length > 0) {
        await writeMissingGuestIdsToSheet(sheetId, tabName, missingGuestIdRows, currentToken);
        missingGuestIdRows.forEach(item => {
          const rIdx = item.rowIndex1Based - 1;
          const cIdx = item.colIndex1Based - 1;
          if (rows[rIdx]) rows[rIdx][cIdx] = item.guestId;
        });
        if (!isQuiet) {
          triggerToast(`Generated & updated ${missingGuestIdRows.length} Guest IDs in Google Sheet!`, 'success');
        }
      }

      if (bookingMutationActive.current || startedAtVersion !== bookingMutationVersion.current) return;
      const parsed = parseSheetToReservations(rows);

      // Check if rows contains a valid header row
      let hasHeaderRow = false;
      for (let r = 0; r < Math.min(rows.length, 35); r++) {
        const rowStr = (rows[r] || []).join(' ').toLowerCase();
        if (rowStr.includes('booking id') || (rowStr.includes('guest') && (rowStr.includes('check-in') || rowStr.includes('check in')))) {
          hasHeaderRow = true;
          break;
        }
      }

      if (parsed.length > 0) {
        setReservations(parsed);
        // Sync records to Firestore
        for (const item of parsed) {
          saveReservationToFirestore(item).catch(() => {});
        }

        setSyncStatus('success');
        const now = new Date().toLocaleTimeString();
        setLastSyncTime(now);
        setSyncMessage(`Synchronized ${parsed.length} reservations with Google Sheet at ${now}`);
        if (!isQuiet) {
          triggerToast(`Successfully synced ${parsed.length} reservations from Google Sheets!`, 'success');
        }
      } else {
        if (hasHeaderRow) {
          // The sheet has headers and 0 bookings (e.g. user deleted all bookings)
          setReservations([]);
        }
        setSyncStatus('success');
        const now = new Date().toLocaleTimeString();
        setLastSyncTime(now);
        setSyncMessage(`Connected to Google Sheet. Tab "${tabName}" has 0 active bookings at ${now}.`);
        if (!isQuiet) {
          triggerToast(`Sheet connected! Tab "${tabName}" has 0 active bookings.`, 'info');
        }
      }
    } catch (err: any) {
      const isExpired =
        err.message?.toLowerCase().includes('expired') ||
        err.message?.includes('401') ||
        err.message?.includes('unauthorized');

      if (isExpired) {
        console.info('Google authorization expired during sync; prompting sign in.');
        clearAccessToken();
        setToken(null);
        setSyncStatus('idle');
        setSyncMessage('Google authorization expired. Please click "Sign in with Google" to refresh permissions.');
        if (!isQuiet) {
          triggerToast('Google authorization expired. Please click "Sign in with Google" to refresh permissions.', 'error');
        }
      } else {
        console.warn('Sync notice:', err.message);
        const friendlyMsg =
          err.message?.includes('Failed to fetch') || err.name === 'TypeError'
            ? 'Network connection to Google Sheets interrupted. Please check your internet connection or sign in again.'
            : err.message || 'Error communicating with Google Sheets';

        setSyncStatus('error');
        setSyncMessage(friendlyMsg);
        if (!isQuiet) {
          triggerToast(`Sync failed: ${friendlyMsg}`, 'error');
        }
      }
    } finally {
      if (!isQuiet) {
        setIsSyncing(false);
      }
    }
  };

  // Background Auto-Sync Timer
  useEffect(() => {
    if (autoSyncInterval === 'off' || !token || !selectedSheetId || isBatchProcessing) return;

    const intervalSeconds = parseInt(autoSyncInterval, 10) || 30;
    setAutoSyncSecondsLeft(intervalSeconds);

    const timer = setInterval(() => {
      setAutoSyncSecondsLeft(prev => {
        if (prev <= 1) {
          syncFromGoogleSheet(selectedSheetId, selectedTabName, token, true);
          return intervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoSyncInterval, token, selectedSheetId, selectedTabName, isBatchProcessing]);

  // Handler to configure Google Sheet Automations via API
  const handleConfigureAutomations = async () => {
    if (!selectedSheetId) {
      triggerToast('Please select a spreadsheet first.', 'error');
      return;
    }
    const currentToken = await getAccessToken();
    if (!currentToken) {
      clearAccessToken();
      setToken(null);
      triggerToast('Google authorization expired. Please click "Sign in with Google" to refresh permissions.', 'error');
      return;
    }

    setIsConfiguringAutomations(true);
    try {
      await setupSheetAutomations(selectedSheetId, selectedTabName, currentToken);
      triggerToast('Google Sheet automations, dropdowns & inventory configured successfully!', 'success');
    } catch (err: any) {
      console.warn('Failed to configure automations:', err.message);
      triggerToast(`Automations setup error: ${err.message}`, 'error');
    } finally {
      setIsConfiguringAutomations(false);
    }
  };

  // Handler to repair all #REF! and broken formulas in Google Sheets
  const handleRepairSheetRefErrors = async () => {
    const currentToken = await getAccessToken();
    const sheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id');
    const tabName = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Booking overview';

    if (!currentToken || !sheetId) {
      clearAccessToken();
      setToken(null);
      triggerToast('Please sign in to Google and connect your spreadsheet first.', 'error');
      return;
    }

    setIsFixingRefErrors(true);
    try {
      triggerToast('Scanning Google Sheet for #REF! and formula errors...', 'info');
      const result = await fixSheetRefErrors(sheetId, tabName, currentToken);
      setSheetRepairStats(result);

      triggerToast(result.message, result.remainingErrors > 0 ? 'error' : 'success');

      // Re-sync after repair
      await syncFromGoogleSheet(sheetId, tabName, currentToken, true);
    } catch (err: any) {
      console.warn('Failed to repair sheet errors:', err.message);
      triggerToast(`Repair failed: ${err.message}`, 'error');
    } finally {
      setIsFixingRefErrors(false);
    }
  };

  // Handler to run automated Bidirectional Sync & Health Test
  const handleRunBidirectionalTest = async () => {
    const currentToken = await getAccessToken();
    const sheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id');
    const tabName = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Booking overview';

    if (!currentToken || !sheetId) {
      clearAccessToken();
      setToken(null);
      triggerToast('Please sign in to Google and connect your spreadsheet before running the sync test.', 'error');
      return;
    }

    setIsTestingSync(true);
    setSyncTestReport(null);
    setTestStepsProgress([]);

    try {
      const report = await runBidirectionalSyncTest(
        sheetId,
        tabName,
        currentToken,
        (step) => {
          setTestStepsProgress(prev => {
            const next = [...prev];
            const idx = next.findIndex(s => s.step === step.step);
            if (idx >= 0) next[idx] = step;
            else next.push(step);
            return next;
          });
        }
      );

      setSyncTestReport(report);
      if (report.success) {
        triggerToast('✅ All bidirectional sync tests passed! App and Google Sheet are fully synchronized.', 'success');
        recordChange(
          'sync',
          'Bidirectional Sync Test Passed',
          'Automated verification completed: Create, Read, In-Place Update, and Row Deletion are working seamlessly.',
          undefined,
          undefined,
          'Bidirectional Sync 100% Operational'
        );
        // Refresh app state
        await syncFromGoogleSheet(sheetId, tabName, currentToken, true);
      } else {
        triggerToast(`Sync test issue: ${report.overallMessage}`, 'error');
      }
    } catch (err: any) {
      console.warn('Sync test error:', err.message);
      triggerToast(`Sync test failed: ${err.message}`, 'error');
    } finally {
      setIsTestingSync(false);
    }
  };

  // Push new/updated reservation to Google Sheet with User Confirmation
  const saveReservationToSheet = async (resData: Reservation, isNew: boolean) => {
    const currentToken = await getAccessToken();
    const activeSheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id') || '';
    const activeTab = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Booking overview';

    if (!currentToken || !activeSheetId) {
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
        await appendReservationToSheet(activeSheetId, activeTab, resData, currentToken);
        triggerToast(`Appended ${resData.id} directly to Google Sheet tab "${activeTab}"!`, 'success');
      } else {
        await updateReservationInSheet(activeSheetId, activeTab, resData, currentToken);
        triggerToast(`Updated ${resData.id} in Google Sheet tab "${activeTab}"!`, 'success');
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
    const roomObj = prefillRoom
      ? HOSTEL_ROOMS.find(r => prefillRoom.includes(r.name) || r.name.toLowerCase() === prefillRoom.toLowerCase()) || HOSTEL_ROOMS[0]
      : HOSTEL_ROOMS[0];
    const targetRoom = `${roomObj.name} (${roomObj.roomCode})`;
    const defaultUnit = roomObj.units[0]?.id || 'M-S1';

    // Current day as default check-in date
    const todayStr = new Date().toISOString().split('T')[0];
    const checkIn = prefillDate || todayStr;
    const nextDate = new Date(checkIn);
    nextDate.setDate(nextDate.getDate() + 3);
    const checkOut = nextDate.toISOString().split('T')[0];

    // Find highest existing MU ID number
    let maxIdNum = 0;
    reservations.forEach(r => {
      const match = r.id.match(/^MU-(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxIdNum) maxIdNum = n;
      }
    });
    const nextId = `MU-${maxIdNum + 1}`;

    setEditingBooking(null);
    setFormData({
      id: nextId,
      guestId: '',
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

  // Update guest name and auto-generate unique Guest ID (First initial + Last initial + unique random number)
  const handleGuestNameChange = (name: string) => {
    setFormData(prev => {
      const isNew = !editingBooking;
      const shouldAuto = isNew || !prev.guestId || prev.guestId.startsWith('GS-');
      const newGuestId = shouldAuto && name.trim()
        ? generateGuestId(name, reservations.map(r => r.guestId || ''))
        : prev.guestId;
      return {
        ...prev,
        guestName: name,
        guestId: newGuestId || prev.guestId
      };
    });
  };

  // Regenerate/roll a fresh random Guest ID for this guest
  const handleRollGuestId = () => {
    const newId = generateGuestId(formData.guestName, reservations.map(r => r.guestId || ''));
    setFormData(prev => ({ ...prev, guestId: newId }));
    triggerToast(`Generated unique Guest ID: ${newId}`, 'info');
  };

  // Handle Edit Reservation modal
  const handleOpenEditModal = (r: Reservation) => {
    setEditingBooking(r);

    // Reconcile bed code with selected room:
    const roomObj = HOSTEL_ROOMS.find(room => r.room.includes(room.name)) || HOSTEL_ROOMS[0];
    let bedCode = r.unitId || r.bedCode;
    const isValidBedForRoom = roomObj.units.some(u => u.id === bedCode);
    if (!isValidBedForRoom) {
      bedCode = roomObj.units[0]?.id || 'M-S1';
    }

    setFormData({
      id: r.id,
      guestId: r.guestId || generateGuestId(r.guestName, reservations.map(res => res.guestId || '')),
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
      guestId: formData.guestId.trim() || generateGuestId(formData.guestName, reservations.map(r => r.guestId || '')),
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

    const snapshotBefore = [...reservations];
    pushUndo(isNew ? `Created booking ${finalRecord.id}` : `Updated booking ${finalRecord.id}`, snapshotBefore);
    recordChange(
      isNew ? 'create' : 'update',
      isNew ? `New Booking: ${finalRecord.id} (${finalRecord.guestName})` : `Booking Updated: ${finalRecord.id} (${finalRecord.guestName})`,
      `${finalRecord.room} (${finalRecord.bedCode}) • ${finalRecord.checkIn} to ${finalRecord.checkOut} • Total $${finalRecord.totalAmount}`,
      finalRecord.id,
      finalRecord.guestName,
      isNew ? `Created reservation ${finalRecord.id}` : `Updated status to "${finalRecord.status}"`,
      snapshotBefore
    );

    if (isNew) {
      setReservations(prev => [finalRecord, ...prev]);
      triggerToast(`Saved ${finalRecord.id} for ${finalRecord.guestName}! Syncing with Google Sheets...`, 'info');
    } else {
      setReservations(prev => prev.map(item => (item.id === finalRecord.id ? finalRecord : item)));
      triggerToast(`Updated ${finalRecord.id}! Syncing with Google Sheets...`, 'info');
    }

    // Direct Google Sheets API sync
    await saveReservationToSheet(finalRecord, isNew);

    // Direct Firebase Firestore sync
    try {
      await saveReservationToFirestore(finalRecord);
    } catch (fsErr) {
      console.warn('Firestore reservation sync note:', fsErr);
    }
  };

  // Check-in guest quick action
  const handleCheckIn = (bookingId: string) => {
    const booking = reservations.find(r => r.id === bookingId);
    if (!booking) return;

    setConfirmModal({
      isOpen: true,
      title: 'Confirm Guest Check-in',
      message: `Mark ${booking.guestName} (${booking.id}) as Checked-in and update Google Sheet & Firebase?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        const snapshotBefore = [...reservations];
        const updated = { ...booking, status: 'Checked-in' };
        pushUndo(`Checked in ${booking.guestName} (${booking.id})`, snapshotBefore);
        recordChange(
          'check_in',
          `Guest Checked In: ${booking.guestName}`,
          `Checked into ${booking.room} • Bed ${booking.bedCode}. Status set to Checked-in.`,
          booking.id,
          booking.guestName,
          'Status: Confirmed → Checked-in',
          snapshotBefore
        );
        setReservations(prev => prev.map(r => (r.id === bookingId ? updated : r)));
        await saveReservationToSheet(updated, false);
        try {
          await saveReservationToFirestore(updated);
        } catch (fsErr) {
          console.warn('Firestore check-in update note:', fsErr);
        }
        triggerToast(`Checked in ${booking.guestName}!`, 'success');
      }
    });
  };

  // Check-out guest quick action
  const handleCheckOut = (bookingId: string) => {
    const booking = reservations.find(r => r.id === bookingId);
    if (!booking) return;

    setConfirmModal({
      isOpen: true,
      title: 'Confirm Guest Check-out',
      message: `Mark ${booking.guestName} (${booking.id}) as Checked-out and update Google Sheet & Firebase?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        const snapshotBefore = [...reservations];
        const updated = { ...booking, status: 'Checked-out' };
        pushUndo(`Checked out ${booking.guestName} (${booking.id})`, snapshotBefore);
        recordChange(
          'check_out',
          `Guest Checked Out: ${booking.guestName}`,
          `Departed from ${booking.room} • Bed ${booking.bedCode}. Bed marked ready for housekeeping.`,
          booking.id,
          booking.guestName,
          'Status: Checked-in → Checked-out',
          snapshotBefore
        );
        setReservations(prev => prev.map(r => (r.id === bookingId ? updated : r)));
        await saveReservationToSheet(updated, false);
        try {
          await saveReservationToFirestore(updated);
        } catch (fsErr) {
          console.warn('Firestore check-out update note:', fsErr);
        }
        triggerToast(`Checked out ${booking.guestName}!`, 'success');
      }
    });
  };

  // Quick Collect Balance Full
  const handleConfirmCollect = async () => {
    if (!collectModalBooking) return;
    const b = collectModalBooking;
    const snapshotBefore = [...reservations];
    const updated: Reservation = {
      ...b,
      paidAmount: b.totalAmount,
      balanceDue: 0
    };

    setCollectModalBooking(null);
    pushUndo(`Collected full payment for ${b.guestName}`, snapshotBefore);
    recordChange(
      'payment',
      `Payment Collected: ${b.guestName}`,
      `Recorded full settlement of $${b.totalAmount} for booking ${b.id}.`,
      b.id,
      b.guestName,
      `Balance due: $${b.balanceDue} → $0`,
      snapshotBefore
    );
    setReservations(prev => prev.map(r => (r.id === b.id ? updated : r)));
    await saveReservationToSheet(updated, false);
    try {
      await saveReservationToFirestore(updated);
    } catch (fsErr) {
      console.warn('Firestore collect payment update note:', fsErr);
    }
    triggerToast(`Collected balance for ${b.guestName}. Marked fully paid!`, 'success');
  };

  // Complete connected writes before reporting success or removing local records.
  const clearConnectedBookings = async (ids: string[], all = false) => {
    if (bookingMutationActive.current) throw new Error('Another booking deletion is still running.');
    bookingMutationActive.current = true;
    bookingMutationVersion.current++;
    try {
    const activeSheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id');
    const activeTab = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Bookings';
    if (activeSheetId) {
      const currentToken = await getAccessToken();
      if (!currentToken) throw new Error('Sign in to Google before deleting connected bookings.');
      if (all) await clearAllBookingsFromSheet(activeSheetId, activeTab, currentToken);
      else await deleteBatchReservationsFromSheet(activeSheetId, activeTab, ids, currentToken);
    }
    try {
      if (all) await clearAllReservationsFromFirestore();
      else for (const id of ids) await deleteReservationFromFirestore(id);
    } catch (error: any) {
      throw new Error((activeSheetId ? 'Spreadsheet rows were cleared, but ' : '') +
        'Firebase deletion failed. Retry to finish synchronizing: ' + (error.message || 'Unknown error'));
    }
    } finally {
      bookingMutationVersion.current++;
      bookingMutationActive.current = false;
    }
  };

  const handleDeleteBooking = (bookingId: string) => {
    const booking = reservations.find(r => r.id === bookingId);
    if (!booking) return;
    setConfirmModal({
      isOpen: true, title: 'Delete Reservation',
      message: `Delete booking ${bookingId} (${booking.guestName}) and clear its spreadsheet row?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsBatchProcessing(true);
        try {
          const snapshotBefore = [...reservations];
          await clearConnectedBookings([bookingId]);
          pushUndo(`Deleted booking ${bookingId}`, snapshotBefore);
          recordChange('delete', `Reservation Deleted: ${bookingId}`, 'Booking data cleared; spreadsheet rows and formulas retained.',
            bookingId, booking.guestName, `Deleted ${bookingId}`, snapshotBefore);
          setReservations(prev => prev.filter(r => r.id !== bookingId));
          setIsBookingModalOpen(false);
          triggerToast(`Deleted ${bookingId} and synchronized connected stores.`, 'success');
        } catch (error: any) {
          setSyncStatus('error');
          setSyncMessage(error.message);
          triggerToast(`Deletion incomplete: ${error.message}`, 'error');
        } finally { setIsBatchProcessing(false); }
      }
    });
  };

  // Sync all current reservations to Firebase Firestore
  const handleSyncAllToFirestore = async () => {
    setIsFirebaseSyncing(true);
    try {
      let count = 0;
      for (const res of reservations) {
        await saveReservationToFirestore(res);
        count++;
      }
      setFirestoreConnected(true);
      triggerToast(`Synced ${count} reservations to Firebase Cloud Database!`, 'success');
    } catch (err: any) {
      console.error('Firebase sync error:', err);
      triggerToast(`Firebase sync failed: ${err.message}`, 'error');
    } finally {
      setIsFirebaseSyncing(false);
    }
  };

  // Pull all records from Firebase Firestore
  const handlePullFromFirestore = async () => {
    setIsFirebaseSyncing(true);
    try {
      const list = await fetchReservationsFromFirestore();
      if (list && list.length > 0) {
        setReservations(list);
        setFirestoreConnected(true);
        triggerToast(`Loaded ${list.length} reservations from Firebase Cloud Database!`, 'success');
      } else {
        triggerToast('No records found in Firebase Firestore yet.', 'info');
      }
    } catch (err: any) {
      console.error('Firebase fetch error:', err);
      triggerToast(`Firebase fetch failed: ${err.message}`, 'error');
    } finally {
      setIsFirebaseSyncing(false);
    }
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

  // Sorting comparison logic
  const sortReservations = (a: Reservation, b: Reservation, field: SortField, dir: SortDirection) => {
    let cmp = 0;
    if (field === 'checkIn') {
      cmp = a.checkIn.localeCompare(b.checkIn);
      if (cmp === 0) cmp = a.checkOut.localeCompare(b.checkOut);
    } else if (field === 'checkOut') {
      cmp = a.checkOut.localeCompare(b.checkOut);
    } else if (field === 'guestName') {
      cmp = a.guestName.localeCompare(b.guestName, undefined, { sensitivity: 'base' });
    } else if (field === 'id') {
      const numA = parseInt(a.id.replace(/[^0-9]/g, ''), 10) || 0;
      const numB = parseInt(b.id.replace(/[^0-9]/g, ''), 10) || 0;
      cmp = numA !== numB ? numA - numB : a.id.localeCompare(b.id);
    } else if (field === 'room') {
      const roomA = a.room || '';
      const roomB = b.room || '';
      const roomCmp = roomA.localeCompare(roomB);
      cmp = roomCmp !== 0 ? roomCmp : (a.unitId || a.bedCode || '').localeCompare(b.unitId || b.bedCode || '');
    } else if (field === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else if (field === 'balanceDue') {
      cmp = a.balanceDue - b.balanceDue;
    } else if (field === 'totalAmount') {
      cmp = a.totalAmount - b.totalAmount;
    }
    return dir === 'asc' ? cmp : -cmp;
  };

  // Filtered and sorted reservations for the bookings tab
  const filteredBookings = useMemo(() => {
    return reservations
      .filter(r => {
        if (statusFilter !== 'ALL' && r.status.toLowerCase() !== statusFilter.toLowerCase()) {
          return false;
        }
        if (globalSearch.trim()) {
          const text = `${r.id} ${r.guestName} ${r.phone} ${r.room} ${r.unitId} ${r.status} ${r.notes}`.toLowerCase();
          if (!text.includes(globalSearch.toLowerCase().trim())) return false;
        }
        return true;
      })
      .sort((a, b) => sortReservations(a, b, sortField, sortDirection));
  }, [reservations, statusFilter, globalSearch, sortField, sortDirection]);

  // Toggle sorting field and direction
  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'checkIn' || field === 'id' || field === 'balanceDue' ? 'desc' : 'asc');
    }
  };

  // Toggle selection for a single booking row
  const handleToggleRowSelection = (bookingId: string) => {
    setSelectedBookingIds(prev =>
      prev.includes(bookingId) ? prev.filter(id => id !== bookingId) : [...prev, bookingId]
    );
  };

  // Master selection toggle for visible rows
  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredBookings.map(b => b.id);
    const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedBookingIds.includes(id));
    if (isAllVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      setSelectedBookingIds(prev => prev.filter(id => !visibleSet.has(id)));
    } else {
      setSelectedBookingIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  // Preset custom selections
  const handleCustomSelect = (type: 'all' | 'none' | 'checked-in' | 'confirmed' | 'checked-out' | 'cancelled' | 'balance-due' | 'paid' | 'invert') => {
    setShowCustomSelectMenu(false);
    if (type === 'all') {
      setSelectedBookingIds(filteredBookings.map(b => b.id));
      triggerToast(`Selected all ${filteredBookings.length} visible bookings.`, 'info');
    } else if (type === 'none') {
      setSelectedBookingIds([]);
      triggerToast('Deselected all bookings.', 'info');
    } else if (type === 'checked-in') {
      const ids = filteredBookings.filter(b => b.status.toLowerCase() === 'checked-in').map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} Checked-in bookings.`, 'info');
    } else if (type === 'confirmed') {
      const ids = filteredBookings.filter(b => b.status.toLowerCase() === 'confirmed').map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} Confirmed bookings.`, 'info');
    } else if (type === 'checked-out') {
      const ids = filteredBookings.filter(b => b.status.toLowerCase() === 'checked-out').map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} Checked-out bookings.`, 'info');
    } else if (type === 'cancelled') {
      const ids = filteredBookings.filter(b => b.status.toLowerCase() === 'cancelled').map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} Cancelled bookings.`, 'info');
    } else if (type === 'balance-due') {
      const ids = filteredBookings.filter(b => b.balanceDue > 0).map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} bookings with unpaid balance.`, 'info');
    } else if (type === 'paid') {
      const ids = filteredBookings.filter(b => b.balanceDue <= 0).map(b => b.id);
      setSelectedBookingIds(ids);
      triggerToast(`Selected ${ids.length} fully settled bookings.`, 'info');
    } else if (type === 'invert') {
      const currentSet = new Set(selectedBookingIds);
      const inverted = filteredBookings.filter(b => !currentSet.has(b.id)).map(b => b.id);
      setSelectedBookingIds(inverted);
      triggerToast(`Inverted selection: ${inverted.length} bookings selected.`, 'info');
    }
  };

  // Batch action: Change status for all selected bookings
  const handleBatchStatusChange = async (newStatus: string) => {
    if (selectedBookingIds.length === 0) return;
    setShowBatchStatusMenu(false);
    const count = selectedBookingIds.length;
    setIsBatchProcessing(true);
    try {
      const snapshotBefore = [...reservations];
      const updatedList = reservations.map(r => {
        if (selectedBookingIds.includes(r.id)) {
          return { ...r, status: newStatus };
        }
        return r;
      });
      pushUndo(`Batch changed status of ${count} bookings to "${newStatus}"`, snapshotBefore);
      recordChange(
        'status_change',
        `Batch Status Change: ${count} Bookings`,
        `Changed status to "${newStatus}" for ${count} reservations.`,
        undefined,
        undefined,
        `Status → ${newStatus}`,
        snapshotBefore
      );
      setReservations(updatedList);

      // Persist to Firestore and Google Sheets for selected items
      const selectedRecords = updatedList.filter(r => selectedBookingIds.includes(r.id));
      const activeSheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id');
      const activeTab = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Booking overview';
      const currentToken = await getAccessToken();

      for (const rec of selectedRecords) {
        try {
          await saveReservationToFirestore(rec);
        } catch (fsErr) {
          console.warn('Firestore batch status note:', fsErr);
        }
        if (currentToken && activeSheetId) {
          try {
            await updateReservationInSheet(activeSheetId, activeTab, rec, currentToken);
          } catch (shErr) {
            console.warn('Sheet batch status note:', shErr);
          }
        }
      }

      triggerToast(`Batch updated ${count} bookings to "${newStatus}" & synced!`, 'success');
      setSelectedBookingIds([]);
    } catch (err: any) {
      triggerToast(`Batch status update failed: ${err.message}`, 'error');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Batch action: Collect balance / Mark fully paid
  const handleBatchCollectBalance = async () => {
    if (selectedBookingIds.length === 0) return;
    const count = selectedBookingIds.length;
    setIsBatchProcessing(true);
    try {
      const snapshotBefore = [...reservations];
      const updatedList = reservations.map(r => {
        if (selectedBookingIds.includes(r.id)) {
          return {
            ...r,
            paidAmount: r.totalAmount,
            balanceDue: 0
          };
        }
        return r;
      });
      pushUndo(`Batch collected payment for ${count} bookings`, snapshotBefore);
      recordChange(
        'payment',
        `Batch Payment Collection: ${count} Bookings`,
        `Marked ${count} reservations as fully settled ($0 balance due).`,
        undefined,
        undefined,
        `Balances marked fully paid`,
        snapshotBefore
      );
      setReservations(updatedList);

      const selectedRecords = updatedList.filter(r => selectedBookingIds.includes(r.id));
      const activeSheetId = selectedSheetId || localStorage.getItem('muh_active_sheet_id');
      const activeTab = selectedTabName || localStorage.getItem('muh_active_tab_name') || 'Booking overview';
      const currentToken = await getAccessToken();

      for (const rec of selectedRecords) {
        try {
          await saveReservationToFirestore(rec);
        } catch (fsErr) {
          console.warn('Firestore batch collect note:', fsErr);
        }
        if (currentToken && activeSheetId) {
          try {
            await updateReservationInSheet(activeSheetId, activeTab, rec, currentToken);
          } catch (shErr) {
            console.warn('Sheet batch collect note:', shErr);
          }
        }
      }

      triggerToast(`Batch marked ${count} bookings as fully paid & synced!`, 'success');
      setSelectedBookingIds([]);
    } catch (err: any) {
      triggerToast(`Batch collect failed: ${err.message}`, 'error');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDelete = () => {
    if (!selectedBookingIds.length) return;
    const ids = [...selectedBookingIds];
    setConfirmModal({
      isOpen: true, title: `Delete ${ids.length} Selected Reservations`,
      message: `Delete these ${ids.length} bookings and clear their spreadsheet rows?`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsBatchProcessing(true);
        try {
          const snapshotBefore = [...reservations];
          await clearConnectedBookings(ids);
          pushUndo(`Batch deleted ${ids.length} bookings`, snapshotBefore);
          recordChange('delete', `Batch Deleted: ${ids.length} Bookings`, 'Cleared selected booking data in connected stores.',
            undefined, undefined, `Deleted ${ids.length} bookings`, snapshotBefore);
          setReservations(prev => prev.filter(r => !ids.includes(r.id)));
          setSelectedBookingIds([]);
          triggerToast(`Deleted and synchronized ${ids.length} bookings.`, 'success');
        } catch (error: any) {
          setSyncStatus('error'); setSyncMessage(error.message);
          triggerToast(`Batch deletion incomplete: ${error.message}`, 'error');
        } finally { setIsBatchProcessing(false); }
      }
    });
  };

  const handleFreshStartWipeAll = () => {
    setConfirmModal({
      isOpen: true, title: 'Fresh Start: Remove All Booking Records',
      message: 'Remove all booking records from the app, Firebase and the connected booking tab? Spreadsheet rows, formatting and calculation formulas will remain.',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setIsBatchProcessing(true);
        try {
          const snapshotBefore = [...reservations];
          await clearConnectedBookings([], true);
          pushUndo(`Fresh start (${snapshotBefore.length} bookings)`, snapshotBefore);
          setReservations([]); setSelectedBookingIds([]);
          localStorage.setItem('muh_reservations_db', '[]');
          recordChange('delete', 'Fresh Start: All Bookings Cleared', 'Connected booking records cleared; worksheet structure preserved.',
            undefined, undefined, 'Fresh start: 0 bookings', snapshotBefore);
          triggerToast('All booking records cleared from connected stores.', 'success');
        } catch (error: any) {
          setSyncStatus('error'); setSyncMessage(error.message);
          triggerToast(`Fresh start incomplete: ${error.message}`, 'error');
        } finally { setIsBatchProcessing(false); }
      }
    });
  };

  // Export selected or filtered bookings to CSV
  const handleExportCsv = (recordsToExport?: Reservation[]) => {
    const list = recordsToExport || (selectedBookingIds.length > 0
      ? reservations.filter(r => selectedBookingIds.includes(r.id))
      : filteredBookings);

    if (list.length === 0) {
      triggerToast('No reservations to export.', 'info');
      return;
    }

    const headers = [
      'Booking ID',
      'Guest Name',
      'Guest ID',
      'Room',
      'Bed Code',
      'Check In',
      'Check Out',
      'Nights',
      'Status',
      'Total USD',
      'Paid USD',
      'Balance USD',
      'Phone',
      'Email',
      'Notes'
    ];

    const rows = list.map(r => [
      `"${r.id}"`,
      `"${(r.guestName || '').replace(/"/g, '""')}"`,
      `"${(r.guestId || '').replace(/"/g, '""')}"`,
      `"${(r.room || '').replace(/"/g, '""')}"`,
      `"${(r.unitId || r.bedCode || '').replace(/"/g, '""')}"`,
      `"${r.checkIn}"`,
      `"${r.checkOut}"`,
      r.nights,
      `"${r.status}"`,
      r.totalAmount,
      r.paidAmount,
      r.balanceDue,
      `"${(r.phone || '').replace(/"/g, '""')}"`,
      `"${(r.email || '').replace(/"/g, '""')}"`,
      `"${(r.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moshi_urban_hostel_bookings_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    triggerToast(`Exported ${list.length} reservations to CSV!`, 'success');
  };

  // Calculate Operational Metrics
  const todayStr = new Date().toISOString().split('T')[0];
  const arrivalsToday = reservations.filter(
    r => r.checkIn === todayStr && r.status !== 'Checked-out' && r.status !== 'Cancelled'
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

  // Calendar Navigation Helpers (Month, Day, and 14-day Timeline)
  const handleCalendarPrev = () => {
    if (calendarView === 'month') {
      const d = new Date(currentCalendarDate);
      d.setMonth(d.getMonth() - 1);
      setCurrentCalendarDate(d);
    } else if (calendarView === 'day') {
      const d = new Date(currentCalendarDate);
      d.setDate(d.getDate() - 1);
      setCurrentCalendarDate(d);
    } else {
      const d = new Date(timelineAnchor);
      d.setDate(d.getDate() - 7);
      setTimelineAnchor(d);
    }
  };

  const handleCalendarNext = () => {
    if (calendarView === 'month') {
      const d = new Date(currentCalendarDate);
      d.setMonth(d.getMonth() + 1);
      setCurrentCalendarDate(d);
    } else if (calendarView === 'day') {
      const d = new Date(currentCalendarDate);
      d.setDate(d.getDate() + 1);
      setCurrentCalendarDate(d);
    } else {
      const d = new Date(timelineAnchor);
      d.setDate(d.getDate() + 7);
      setTimelineAnchor(d);
    }
  };

  const handleCalendarToday = () => {
    const today = new Date();
    setCurrentCalendarDate(today);
    setTimelineAnchor(today);
  };

  // Monthly Calendar Matrix Generation (35 or 42 grid cells)
  const monthCalendarData = useMemo(() => {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      activeBookings: Reservation[];
      arrivals: Reservation[];
      departures: Reservation[];
      occupiedBedsCount: number;
    }[] = [];

    const realTodayStr = new Date().toISOString().split('T')[0];

    // Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const dateStr = prevDate.toISOString().split('T')[0];
      const activeBookings = reservations.filter(
        r => r.status !== 'Cancelled' && dateStr >= r.checkIn && dateStr < r.checkOut
      );
      const arrivals = reservations.filter(r => r.status !== 'Cancelled' && r.checkIn === dateStr);
      const departures = reservations.filter(r => r.status !== 'Cancelled' && r.checkOut === dateStr);
      const occupiedBedsCount = activeBookings.reduce((sum, r) => sum + (r.bedsCount || 1), 0);
      cells.push({
        dateStr,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: dateStr === realTodayStr,
        activeBookings,
        arrivals,
        departures,
        occupiedBedsCount
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const curDate = new Date(year, month, d);
      const dateStr = curDate.toISOString().split('T')[0];
      const activeBookings = reservations.filter(
        r => r.status !== 'Cancelled' && dateStr >= r.checkIn && dateStr < r.checkOut
      );
      const arrivals = reservations.filter(r => r.status !== 'Cancelled' && r.checkIn === dateStr);
      const departures = reservations.filter(r => r.status !== 'Cancelled' && r.checkOut === dateStr);
      const occupiedBedsCount = activeBookings.reduce((sum, r) => sum + (r.bedsCount || 1), 0);
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateStr === realTodayStr,
        activeBookings,
        arrivals,
        departures,
        occupiedBedsCount
      });
    }

    // Next month leading days (fill up to 35 or 42 grid cells)
    const targetLength = cells.length > 35 ? 42 : 35;
    const remaining = targetLength - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const dateStr = nextDate.toISOString().split('T')[0];
      const activeBookings = reservations.filter(
        r => r.status !== 'Cancelled' && dateStr >= r.checkIn && dateStr < r.checkOut
      );
      const arrivals = reservations.filter(r => r.status !== 'Cancelled' && r.checkIn === dateStr);
      const departures = reservations.filter(r => r.status !== 'Cancelled' && r.checkOut === dateStr);
      const occupiedBedsCount = activeBookings.reduce((sum, r) => sum + (r.bedsCount || 1), 0);
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === realTodayStr,
        activeBookings,
        arrivals,
        departures,
        occupiedBedsCount
      });
    }

    return cells;
  }, [currentCalendarDate, reservations]);

  // Day View Computations for currently selected date
  const selectedDayStr = currentCalendarDate.toISOString().split('T')[0];
  const dayActiveReservations = useMemo(() => {
    return reservations.filter(
      r => r.status !== 'Cancelled' && selectedDayStr >= r.checkIn && selectedDayStr < r.checkOut
    );
  }, [reservations, selectedDayStr]);

  const dayArrivals = useMemo(() => {
    return reservations.filter(r => r.status !== 'Cancelled' && r.checkIn === selectedDayStr);
  }, [reservations, selectedDayStr]);

  const dayDepartures = useMemo(() => {
    return reservations.filter(r => r.status !== 'Cancelled' && r.checkOut === selectedDayStr);
  }, [reservations, selectedDayStr]);

  const dayOccupiedBedsCount = useMemo(() => {
    return dayActiveReservations.reduce((sum, r) => sum + (r.bedsCount || 1), 0);
  }, [dayActiveReservations]);

  // Filter change logs for past 3 days (Today, Yesterday, 2-3 Days Ago)
  const filteredChangeLogs = useMemo(() => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const todayYMD = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayYMD = yesterday.toISOString().split('T')[0];

    return changeLogs.filter(item => {
      const itemDate = new Date(item.timestamp);
      if (itemDate < threeDaysAgo) return false;
      const itemYMD = item.timestamp.split('T')[0];

      if (changeLogFilter === 'today') return itemYMD === todayYMD;
      if (changeLogFilter === 'yesterday') return itemYMD === yesterdayYMD;
      if (changeLogFilter === 'older') return itemYMD !== todayYMD && itemYMD !== yesterdayYMD;
      return true;
    });
  }, [changeLogs, changeLogFilter]);

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
                className="px-5 py-2 text-xs font-bold text-[#0d1726] bg-[#fdbe4e] hover:bg-[#ebb043] rounded-xl shadow-md transition"
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
          sidebarCollapsed ? 'md:w-14' : 'md:w-64'
        } ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#0d1726] text-slate-300 flex flex-col shrink-0 border-r border-[#19263b] select-none transition-all duration-300 ease-in-out`}
      >
        {/* Brand Header */}
        <div className={`p-4 border-b border-[#1b2a41] flex items-center ${sidebarCollapsed ? 'md:justify-center md:p-3' : 'justify-between'} min-h-[68px]`}>
          {(!sidebarCollapsed || mobileSidebarOpen) ? (
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <img
                src="/moshi_urban_logo_horizontal_white.svg"
                alt="Moshi Urban Hostel & Backpackers"
                className="h-10 w-auto object-contain max-w-[170px]"
              />
              <span className="bg-[#fdbe4e]/25 text-[#fdbe4e] text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#fdbe4e]/50 shrink-0">
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
                className="w-7 h-7 object-contain hover:scale-110 transition-transform"
              />
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
                ? 'absolute -right-3 top-5 bg-[#fdbe4e] text-[#0d1726] shadow-md hover:bg-[#ebb043] w-6 h-6 rounded-full'
                : 'text-slate-400 hover:text-white hover:bg-[#1a283f] p-1.5 rounded-lg'
            } transition z-20 cursor-pointer items-center justify-center`}
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
        <nav className={`${sidebarCollapsed ? 'md:px-1.5 md:py-3' : 'p-3'} space-y-1.5 flex-1 text-xs font-medium`}>
          <button
            onClick={() => {
              setActiveTab('overview');
              setMobileSidebarOpen(false);
            }}
            title="Overview"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'overview'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <Layers className={`w-5 h-5 shrink-0 ${activeTab === 'overview' ? 'text-[#fdbe4e]' : 'text-slate-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Overview</span>}
            </div>
            {(!sidebarCollapsed || mobileSidebarOpen) && arrivalsToday.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#fdbe4e] text-[#0d1726] font-bold text-[10px] flex items-center justify-center">
                {arrivalsToday.length}
              </span>
            )}
            {sidebarCollapsed && !mobileSidebarOpen && arrivalsToday.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#fdbe4e] ring-2 ring-[#0d1726]" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('bookings');
              setMobileSidebarOpen(false);
            }}
            title="Bookings"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'bookings'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <Calendar className={`w-5 h-5 shrink-0 ${activeTab === 'bookings' ? 'text-[#fdbe4e]' : 'text-slate-400 group-hover:text-white'}`} />
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
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer group ${
              activeTab === 'availability'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <Bed className={`w-5 h-5 shrink-0 ${activeTab === 'availability' ? 'text-[#fdbe4e]' : 'text-slate-400 group-hover:text-white'}`} />
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
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer group ${
              activeTab === 'rooms'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <Building2 className={`w-5 h-5 shrink-0 ${activeTab === 'rooms' ? 'text-[#fdbe4e]' : 'text-slate-400 group-hover:text-white'}`} />
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
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'sheets'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <FileSpreadsheet className={`w-5 h-5 shrink-0 ${activeTab === 'sheets' ? 'text-[#fdbe4e]' : 'text-emerald-400'}`} />
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
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                  user ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
            )}
          </button>

          {/* Change Log Item (Past 3 Days) - Like Elementor Change Log */}
          <button
            onClick={() => {
              setActiveTab('changelog');
              setMobileSidebarOpen(false);
            }}
            title="Change Log (Past 3 Days)"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'md:justify-center md:h-10 md:w-10 md:mx-auto md:p-0 justify-between px-3.5 py-2.5' : 'justify-between px-3.5 py-2.5'
            } rounded-xl transition cursor-pointer relative group ${
              activeTab === 'changelog'
                ? 'text-white bg-[#19273f] font-semibold border-l-2 md:border-l-0 md:ring-1 md:ring-[#fdbe4e]/60 border-[#fdbe4e]'
                : 'text-slate-400 hover:text-white hover:bg-[#132035]'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'space-x-3'}`}>
              <History className={`w-5 h-5 shrink-0 ${activeTab === 'changelog' ? 'text-[#fdbe4e]' : 'text-amber-400 group-hover:text-white'}`} />
              {(!sidebarCollapsed || mobileSidebarOpen) && <span>Change Log</span>}
            </div>
            {(!sidebarCollapsed || mobileSidebarOpen) && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-[#fdbe4e] font-bold">
                {changeLogs.length}
              </span>
            )}
            {sidebarCollapsed && !mobileSidebarOpen && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#fdbe4e]" />
            )}
          </button>
        </nav>

        {/* User Account / Google Connection Footer */}
        <div className={`${sidebarCollapsed ? 'md:p-2 md:py-3' : 'p-3'} border-t border-[#1b2a41] bg-[#09111d]`}>
          {user ? (
            <div className={`flex items-center ${sidebarCollapsed ? 'md:justify-center' : 'justify-between'} px-1 py-1.5`}>
              <div className="flex items-center space-x-2.5 overflow-hidden" title={user.displayName || user.email || 'Google Account'}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="User" className="w-7 h-7 rounded-lg object-cover shadow shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-[#fdbe4e] text-[#0d1726] font-bold text-xs flex items-center justify-center shadow shrink-0">
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
                  sidebarCollapsed ? 'md:h-9 md:w-9 md:mx-auto md:p-0' : 'space-x-2 py-2 px-3'
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
                className="w-full bg-[#f6f3ed] border border-[#e5dfd3] rounded-xl pl-8 sm:pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#fdbe4e] focus:bg-white transition"
              />
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 absolute left-2.5 sm:left-3 top-2.5" />
            </div>
          </div>

          {/* Right Header Buttons */}
          <div className="flex items-center space-x-1.5 sm:space-x-3">

            {/* Live Auto-Sync Indicator & Quick Refresh */}
            {selectedSheetId && (
              <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#faf8f5] border border-[#e8e4dc] text-[11px]">
                <span className={`w-2 h-2 rounded-full ${autoSyncInterval !== 'off' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                <span className="font-semibold text-slate-700">
                  {autoSyncInterval !== 'off' ? `Auto-Sync (${autoSyncSecondsLeft}s)` : 'Manual Sync'}
                </span>
                <button
                  onClick={() => syncFromGoogleSheet()}
                  disabled={isSyncing}
                  title="Pull latest updates now"
                  className="text-slate-400 hover:text-slate-800 transition p-0.5 rounded cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#fdbe4e]' : ''}`} />
                </button>
              </div>
            )}

            {/* Google Sheet Automations Modal Button */}
            <button
              onClick={() => setIsAutomationsModalOpen(true)}
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200/80 rounded-xl text-xs font-semibold transition cursor-pointer shadow-2xs"
              title="Google Sheet Automations, Dropdowns & Apps Script"
            >
              <Zap className="w-3.5 h-3.5 text-[#fdbe4e]" />
              <span>Sheet Automations</span>
            </button>

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
                      <Bell className="w-4 h-4 text-[#fdbe4e]" />
                      <span className="font-bold text-xs">Action Center</span>
                      <span className="bg-[#fdbe4e]/20 text-[#fdbe4e] text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold">
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

            {/* Firebase Cloud Sync Button */}
            <button
              onClick={() => handleSyncAllToFirestore()}
              disabled={isFirebaseSyncing}
              title={firestoreConnected ? 'Firebase Cloud Database active. Click to sync all local records to Firebase.' : 'Firebase Cloud Database'}
              className={`hidden md:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition border cursor-pointer ${
                firestoreConnected
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${isFirebaseSyncing ? 'animate-bounce text-[#fdbe4e]' : 'text-[#fdbe4e]'}`} />
              <span className="hidden xl:inline">
                {isFirebaseSyncing ? 'Syncing Firebase...' : 'Firebase Cloud'}
              </span>
            </button>

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

            {/* Live Bidirectional Sync Test Button */}
            {selectedSheetId && (
              <button
                onClick={() => {
                  setIsSyncTestModalOpen(true);
                  if (!isTestingSync && !syncTestReport) {
                    handleRunBidirectionalTest();
                  }
                }}
                disabled={isTestingSync}
                className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-[#0d1726] hover:bg-[#1b2b45] text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Run live bidirectional verification test (App ⇄ Google Sheet)"
              >
                <Activity className={`w-3.5 h-3.5 text-[#fdbe4e] ${isTestingSync ? 'animate-pulse' : ''}`} />
                <span>Test Sync</span>
              </button>
            )}

            {/* Fix Sheet #REF! Errors Button */}
            {selectedSheetId && (
              <button
                onClick={handleRepairSheetRefErrors}
                disabled={isFixingRefErrors}
                className="hidden xl:flex items-center space-x-1.5 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                title="Check all workbook tabs for formula errors"
              >
                <Wrench className={`w-3.5 h-3.5 text-rose-600 ${isFixingRefErrors ? 'animate-spin' : ''}`} />
                <span>Check formulas</span>
              </button>
            )}

            {/* Currency Selector */}
            <div className="flex bg-[#f6f3ed] p-0.5 rounded-lg border border-[#e5dfd3] text-[11px] font-semibold">
              {(['USD', 'TZS', 'EUR'] as const).map(curr => (
                <button
                  key={curr}
                  onClick={() => setCurrency(curr)}
                  className={`px-1.5 sm:px-2 py-0.5 rounded transition ${
                    currency === curr ? 'bg-[#fdbe4e] text-[#0d1726] font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>

            {/* Create Reservation Button */}
            <button
              onClick={() => handleOpenNewModal()}
              className="flex items-center space-x-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs px-3 sm:px-4 py-2 rounded-xl shadow-xs transition transform active:scale-95 cursor-pointer shrink-0"
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
            <div className="space-y-4 animate-in fade-in duration-150">
              
              {/* Header Title & Top Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Bookings</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sort, multi-select, and execute batch status actions, record payments, and manage folios synchronized with Google Sheets & Firebase.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleExportCsv()}
                    className="flex items-center space-x-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs px-3.5 py-2 rounded-xl border border-[#e8e4dc] shadow-2xs transition cursor-pointer"
                    title="Export bookings to CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Export CSV</span>
                  </button>
                  {/* Undo Button */}
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title={undoStack.length > 0 ? `Undo last change: ${undoStack[undoStack.length - 1].actionName} (Ctrl+Z)` : 'Nothing to undo'}
                    className="flex items-center space-x-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs px-3.5 py-2 rounded-xl border border-[#e8e4dc] shadow-2xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-amber-600" />
                    <span>Undo</span>
                    {undoStack.length > 0 && (
                      <span className="ml-0.5 bg-amber-100 text-amber-900 font-mono text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                        {undoStack.length}
                      </span>
                    )}
                  </button>
                  {/* Fresh Start: Clear All Bookings */}
                  <button
                    onClick={handleFreshStartWipeAll}
                    disabled={isBatchProcessing}
                    className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs px-3.5 py-2 rounded-xl border border-rose-200 shadow-2xs transition cursor-pointer disabled:opacity-50"
                    title="Remove all booking records from both the App and the Google Sheet for a clean fresh start"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Fresh Start (Clear All)</span>
                  </button>
                </div>
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

                <div className="flex items-center space-x-3 text-xs text-slate-500 font-mono px-2">
                  <span>Showing <strong>{filteredBookings.length}</strong> of {reservations.length} records</span>
                  {selectedBookingIds.length > 0 && (
                    <span className="bg-amber-100 text-amber-900 font-semibold px-2 py-0.5 rounded-full border border-amber-300 text-[11px]">
                      {selectedBookingIds.length} selected
                    </span>
                  )}
                </div>
              </div>

              {/* Selection Mode & Custom Selection Toolbar Controls (Sorting done directly on table headers) */}
              <div className="bg-white p-3.5 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  
                  {/* Selection Mode & Custom Selection Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    
                    {/* Toggle Selection Mode Button */}
                    <button
                      onClick={() => setIsSelectionMode(prev => !prev)}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                        isSelectionMode
                          ? 'bg-amber-50 text-amber-900 border-amber-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="Toggle checkbox multi-select mode"
                    >
                      {isSelectionMode ? (
                        <CheckSquare className="w-3.5 h-3.5 text-[#fdbe4e]" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>Selection Mode: {isSelectionMode ? 'ON' : 'OFF'}</span>
                    </button>

                    {/* Custom Selection Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setShowCustomSelectMenu(prev => !prev)}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#e8e4dc] rounded-xl text-xs font-semibold shadow-2xs transition cursor-pointer"
                      >
                        <Filter className="w-3.5 h-3.5 text-slate-500" />
                        <span>Select Options</span>
                        <ChevronDown className="w-3 h-3 text-slate-400" />
                      </button>

                      {showCustomSelectMenu && (
                        <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl shadow-lg border border-[#e8e4dc] p-1.5 z-30 animate-in fade-in zoom-in-95 text-xs">
                          <button
                            onClick={() => handleCustomSelect('all')}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 hover:text-amber-900 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>Select All Visible</span>
                            <span className="font-mono text-[10px] text-slate-400">({filteredBookings.length})</span>
                          </button>
                          <button
                            onClick={() => handleCustomSelect('none')}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-600 rounded-lg font-medium transition cursor-pointer"
                          >
                            Deselect All
                          </button>
                          <div className="h-px bg-slate-100 my-1" />
                          <button
                            onClick={() => handleCustomSelect('balance-due')}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 hover:text-amber-900 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>With Unpaid Balance (&gt; $0)</span>
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                          </button>
                          <button
                            onClick={() => handleCustomSelect('checked-in')}
                            className="w-full text-left px-3 py-2 hover:bg-emerald-50 hover:text-emerald-900 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>Checked-in Only</span>
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          </button>
                          <button
                            onClick={() => handleCustomSelect('confirmed')}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 hover:text-blue-900 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>Confirmed Only</span>
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                          </button>
                          <button
                            onClick={() => handleCustomSelect('checked-out')}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>Checked-out Only</span>
                            <span className="w-2 h-2 rounded-full bg-slate-400" />
                          </button>
                          <button
                            onClick={() => handleCustomSelect('cancelled')}
                            className="w-full text-left px-3 py-2 hover:bg-rose-50 hover:text-rose-900 rounded-lg font-medium transition cursor-pointer flex items-center justify-between"
                          >
                            <span>Cancelled Only</span>
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                          </button>
                          <div className="h-px bg-slate-100 my-1" />
                          <button
                            onClick={() => handleCustomSelect('invert')}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition cursor-pointer"
                          >
                            Invert Current Selection
                          </button>
                        </div>
                      )}
                    </div>

                    {selectedBookingIds.length > 0 && (
                      <button
                        onClick={() => setSelectedBookingIds([])}
                        className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                        title="Clear current selection"
                      >
                        Clear ({selectedBookingIds.length})
                      </button>
                    )}

                  </div>
                </div>
              </div>

              {/* BATCH ACTIONS BAR (Visible when 1 or more bookings are selected) */}
              {selectedBookingIds.length > 0 && (
                <div className="bg-[#0d1726] text-white p-3 sm:p-4 rounded-2xl border border-amber-500/40 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-xl bg-[#fdbe4e]/20 border border-[#fdbe4e]/50 flex items-center justify-center shrink-0">
                      <CheckSquare className="w-4 h-4 text-[#fdbe4e]" />
                    </div>
                    <div>
                      <div className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
                        <span>{selectedBookingIds.length} Bookings Selected</span>
                        {isBatchProcessing && (
                          <span className="inline-flex items-center text-[11px] font-normal text-amber-300">
                            <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                            Updating...
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Perform bulk actions synchronized with Google Sheets and Firestore.
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    
                    {/* Batch Change Status Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowBatchStatusMenu(prev => !prev)}
                        disabled={isBatchProcessing}
                        className="flex items-center space-x-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Change Status</span>
                        <ChevronDown className="w-3 h-3 ml-0.5" />
                      </button>

                      {showBatchStatusMenu && (
                        <div className="absolute right-0 mt-1.5 w-48 bg-white text-slate-800 rounded-xl shadow-xl border border-[#e8e4dc] p-1.5 z-40 animate-in fade-in zoom-in-95 text-xs">
                          <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-400">
                            Apply to {selectedBookingIds.length} bookings:
                          </div>
                          {(['Confirmed', 'Checked-in', 'Checked-out', 'Tentative', 'Cancelled'] as const).map(st => (
                            <button
                              key={st}
                              onClick={() => handleBatchStatusChange(st)}
                              className="w-full text-left px-3 py-2 hover:bg-amber-50 hover:text-amber-900 rounded-lg font-semibold transition cursor-pointer flex items-center space-x-2"
                            >
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  st === 'Checked-in'
                                    ? 'bg-emerald-500'
                                    : st === 'Confirmed'
                                    ? 'bg-blue-500'
                                    : st === 'Cancelled'
                                    ? 'bg-rose-500'
                                    : 'bg-amber-500'
                                }`}
                              />
                              <span>Mark as {st}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Batch Collect Payment */}
                    <button
                      onClick={handleBatchCollectBalance}
                      disabled={isBatchProcessing}
                      className="flex items-center space-x-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                      title="Set balance to zero and mark fully paid for selected bookings"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Collect & Mark Paid</span>
                    </button>

                    {/* Batch Export Selected CSV */}
                    <button
                      onClick={() => handleExportCsv(reservations.filter(r => selectedBookingIds.includes(r.id)))}
                      disabled={isBatchProcessing}
                      className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                      title="Export selected bookings to CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Selected</span>
                    </button>

                    {/* Batch Delete */}
                    <button
                      onClick={handleBatchDelete}
                      disabled={isBatchProcessing}
                      className="flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                      title="Permanently delete selected bookings"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete ({selectedBookingIds.length})</span>
                    </button>

                    {/* Deselect All (X) */}
                    <button
                      onClick={() => setSelectedBookingIds([])}
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                      title="Deselect all"
                    >
                      <X className="w-4 h-4" />
                    </button>

                  </div>
                </div>
              )}

              {/* Bookings Table */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-[#f9f7f2] border-b border-[#e8e4dc] text-slate-400 font-semibold tracking-wider uppercase text-[10px]">
                      <tr>
                        
                        {/* Master Select Checkbox Column */}
                        <th className="py-3.5 pl-4 pr-2 w-10 text-center">
                          {isSelectionMode ? (
                            <button
                              type="button"
                              onClick={handleToggleSelectAllVisible}
                              className="text-slate-500 hover:text-slate-800 transition cursor-pointer p-1"
                              title={
                                filteredBookings.length > 0 && filteredBookings.every(b => selectedBookingIds.includes(b.id))
                                  ? 'Deselect all visible'
                                  : 'Select all visible'
                              }
                            >
                              {filteredBookings.length > 0 && filteredBookings.every(b => selectedBookingIds.includes(b.id)) ? (
                                <CheckSquare className="w-4 h-4 text-[#fdbe4e]" />
                              ) : filteredBookings.some(b => selectedBookingIds.includes(b.id)) ? (
                                <MinusSquare className="w-4 h-4 text-amber-600" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">#</span>
                          )}
                        </th>

                        {/* Booking ID Header */}
                        <th
                          onClick={() => handleSortToggle('id')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Booking ID</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'id' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        {/* Guest Header */}
                        <th
                          onClick={() => handleSortToggle('guestName')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Guest</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'guestName' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        {/* Room & Unit Header */}
                        <th
                          onClick={() => handleSortToggle('room')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Room & Unit</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'room' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        {/* Dates Header */}
                        <th
                          onClick={() => handleSortToggle('checkIn')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Dates</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'checkIn' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        {/* Status Header */}
                        <th
                          onClick={() => handleSortToggle('status')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Status</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'status' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        {/* Balance Due Header */}
                        <th
                          onClick={() => handleSortToggle('balanceDue')}
                          className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition select-none group"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span>Balance Due</span>
                            <span className="text-slate-400 group-hover:text-slate-700">
                              {sortField === 'balanceDue' ? (
                                sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[#fdbe4e]" /> : <ArrowDown className="w-3 h-3 text-[#fdbe4e]" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                              )}
                            </span>
                          </div>
                        </th>

                        <th className="py-3.5 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2ede4] font-medium text-slate-700">
                      {filteredBookings.map(r => {
                        const isSelected = selectedBookingIds.includes(r.id);
                        return (
                          <tr
                            key={r.id}
                            className={`transition-colors ${
                              isSelected
                                ? 'bg-amber-50/80 hover:bg-amber-100/70 border-l-4 border-l-[#fdbe4e]'
                                : 'hover:bg-[#faf8f5]'
                            }`}
                          >
                            {/* Row Checkbox Cell */}
                            <td className="py-3 pl-4 pr-2 text-center">
                              {isSelectionMode ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleRowSelection(r.id)}
                                  className="text-slate-500 hover:text-slate-800 transition cursor-pointer p-1"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-[#fdbe4e]" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                                  )}
                                </button>
                              ) : (
                                <span className="font-mono text-[11px] text-slate-300">·</span>
                              )}
                            </td>

                            <td className="py-3 px-4 font-mono font-bold text-slate-800">{r.id}</td>
                            <td className="py-3 px-4">
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
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-800">{r.room}</div>
                              <div className="text-[11px] text-amber-900 font-mono font-bold">{r.unitId || r.bedCode}</div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-slate-800">{r.checkIn} – {r.checkOut}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{r.nights} nights</div>
                            </td>
                            <td className="py-3 px-4">
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
                            <td className="py-3 px-4">
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
                              <div className="flex items-center justify-end space-x-1.5">
                                {r.status.toLowerCase() !== 'checked-in' && r.status.toLowerCase() !== 'checked-out' && r.status.toLowerCase() !== 'cancelled' && (
                                  <button
                                    onClick={() => handleCheckIn(r.id)}
                                    className="px-2 py-1 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 rounded-lg text-xs font-semibold transition cursor-pointer border border-emerald-200"
                                    title="Quick Check-in"
                                  >
                                    Check In
                                  </button>
                                )}
                                <button
                                  onClick={() => handleOpenEditModal(r)}
                                  className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-semibold transition cursor-pointer"
                                >
                                  Edit / View
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredBookings.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-12 text-center">
                            <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto">
                              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                                <Sparkles className="w-6 h-6 text-[#fdbe4e]" />
                              </div>
                              <div className="space-y-1">
                                <h4 className="text-sm font-bold text-slate-800">
                                  {reservations.length === 0 ? 'Fresh Start: No Booking Records' : 'No matching bookings found'}
                                </h4>
                                <p className="text-xs text-slate-500">
                                  {reservations.length === 0
                                    ? 'The app and Google Sheet are clean with 0 booking records. Ready for your first fresh reservation.'
                                    : 'No reservations match your current search or filter parameters.'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => handleOpenNewModal()}
                                  className="px-4 py-2 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>+ New Booking</span>
                                </button>
                                {reservations.length > 0 && (
                                  <button
                                    onClick={() => setStatusFilter('ALL')}
                                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
                                  >
                                    Reset Status Filter
                                  </button>
                                )}
                              </div>
                            </div>
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
          {/* TAB 3: AVAILABILITY & BOOKING CALENDAR                   */}
          {/* ======================================================== */}
          {activeTab === 'availability' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              
              {/* Header: Title, View Switcher & Date Navigation */}
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Availability Calendar</h1>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold border border-amber-300">
                      Live
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Front-desk booking calendar & room inventory. Switch between Monthly View, Day View, and 14-Day Matrix.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* View Switcher Tabs */}
                  <div className="flex items-center bg-[#f5f2eb] p-1 rounded-xl border border-[#e8e4dc]">
                    <button
                      onClick={() => setCalendarView('month')}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        calendarView === 'month'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5 text-[#fdbe4e]" />
                      <span>Monthly View</span>
                    </button>
                    <button
                      onClick={() => setCalendarView('day')}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        calendarView === 'day'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5 text-[#fdbe4e]" />
                      <span>Day View</span>
                    </button>
                    <button
                      onClick={() => setCalendarView('timeline')}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        calendarView === 'timeline'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-[#fdbe4e]" />
                      <span>14-Day Matrix</span>
                    </button>
                  </div>

                  {/* Date Navigation Controls */}
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={handleCalendarPrev}
                      className="p-1.5 border border-[#e8e4dc] rounded-xl hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title={calendarView === 'month' ? 'Previous Month' : calendarView === 'day' ? 'Previous Day' : 'Previous 7 Days'}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCalendarToday}
                      className="px-3 py-1.5 text-xs bg-[#faf8f5] hover:bg-amber-50 text-slate-800 hover:text-amber-950 font-bold border border-[#e8e4dc] hover:border-amber-300 rounded-xl transition cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      onClick={handleCalendarNext}
                      className="p-1.5 border border-[#e8e4dc] rounded-xl hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title={calendarView === 'month' ? 'Next Month' : calendarView === 'day' ? 'Next Day' : 'Next 7 Days'}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Active Date Label & Date Picker */}
                  <div className="flex items-center space-x-2 bg-[#faf8f5] border border-[#e8e4dc] px-3 py-1.5 rounded-xl text-xs font-bold text-slate-800">
                    <CalendarDays className="w-4 h-4 text-[#fdbe4e]" />
                    <span>
                      {calendarView === 'month'
                        ? currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                        : calendarView === 'day'
                        ? currentCalendarDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                        : `${new Date(timelineAnchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(new Date(timelineAnchor).setDate(timelineAnchor.getDate() + 13)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                    <input
                      type="date"
                      value={currentCalendarDate.toISOString().split('T')[0]}
                      onChange={e => {
                        if (e.target.value) {
                          const picked = new Date(e.target.value + 'T00:00:00');
                          setCurrentCalendarDate(picked);
                          setTimelineAnchor(picked);
                        }
                      }}
                      className="opacity-0 w-4 h-4 absolute cursor-pointer"
                      title="Jump to date"
                    />
                  </div>

                  {/* Quick Action: New Reservation */}
                  <button
                    onClick={() => handleOpenNewModal(undefined, currentCalendarDate.toISOString().split('T')[0])}
                    className="flex items-center space-x-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Booking</span>
                  </button>
                </div>
              </div>

              {/* ========================================================= */}
              {/* VIEW 1: MONTHLY CALENDAR VIEW                            */}
              {/* ========================================================= */}
              {calendarView === 'month' && (
                <div className="bg-white rounded-2xl border border-[#e8e4dc] p-4 sm:p-5 shadow-2xs space-y-3">
                  
                  {/* Month Grid Header: Days of the Week */}
                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold tracking-wider uppercase text-slate-400 pb-2 border-b border-[#f0ede6]">
                    <span>Sun</span>
                    <span>Mon</span>
                    <span>Tue</span>
                    <span>Wed</span>
                    <span>Thu</span>
                    <span>Fri</span>
                    <span>Sat</span>
                  </div>

                  {/* 35 or 42 Calendar Cells */}
                  <div className="grid grid-cols-7 gap-2">
                    {monthCalendarData.map((cell, idx) => {
                      const totalBeds = 16;
                      const freeBeds = Math.max(0, totalBeds - cell.occupiedBedsCount);
                      const isFull = cell.occupiedBedsCount >= totalBeds;
                      const isPartiallyBooked = cell.occupiedBedsCount > 0 && !isFull;

                      return (
                        <div
                          key={idx}
                          className={`min-h-[110px] sm:min-h-[125px] p-2 rounded-xl border flex flex-col justify-between transition group relative ${
                            cell.isToday
                              ? 'bg-amber-50/70 border-amber-400 ring-2 ring-[#fdbe4e]/40 shadow-xs'
                              : cell.isCurrentMonth
                              ? 'bg-white border-[#e8e4dc] hover:border-amber-300 hover:shadow-xs'
                              : 'bg-slate-50/70 border-slate-200/60 opacity-60'
                          }`}
                        >
                          {/* Cell Top: Date Number & Daily Occupancy Pill */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1">
                              <span
                                className={`text-xs font-bold font-mono ${
                                  cell.isToday
                                    ? 'w-6 h-6 rounded-full bg-[#fdbe4e] text-[#0d1726] flex items-center justify-center shadow-xs font-black'
                                    : cell.isCurrentMonth
                                    ? 'text-slate-800'
                                    : 'text-slate-400'
                                }`}
                              >
                                {cell.dayNumber}
                              </span>
                              {cell.isToday && (
                                <span className="text-[9px] font-bold text-amber-800 uppercase tracking-wider hidden sm:inline">
                                  Today
                                </span>
                              )}
                            </div>

                            {/* Occupancy pill indicator */}
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md font-semibold ${
                                isFull
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : isPartiallyBooked
                                  ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                              title={`${cell.occupiedBedsCount} of ${totalBeds} beds booked (${freeBeds} free)`}
                            >
                              {cell.occupiedBedsCount > 0 ? `${cell.occupiedBedsCount}/16b` : '16 free'}
                            </span>
                          </div>

                          {/* Cell Middle: Booking Chips for Active Guests on this day */}
                          <div className="space-y-1 my-1.5 flex-1 overflow-y-auto max-h-[75px]">
                            {cell.activeBookings.slice(0, 3).map(b => {
                              const isCheckedIn = b.status.toLowerCase() === 'checked-in';
                              const isConfirmed = b.status.toLowerCase() === 'confirmed';
                              const isCheckedOut = b.status.toLowerCase() === 'checked-out';

                              return (
                                <div
                                  key={b.id}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setSelectedBookingInfo({
                                      roomName: b.room,
                                      dateStr: cell.dateStr,
                                      bookings: [b]
                                    });
                                  }}
                                  title={`${b.guestName} (${b.id}) • ${b.room} [${b.unitId || b.bedCode}] • ${b.status} • Click to view`}
                                  className={`px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer transition flex items-center space-x-1 border ${
                                    isCheckedIn
                                      ? 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                                      : isConfirmed
                                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                                      : isCheckedOut
                                      ? 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                                      : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      isCheckedIn ? 'bg-blue-500' : isConfirmed ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                  />
                                  <span className="font-semibold truncate">{b.guestName.split(' ')[0]}</span>
                                  <span className="opacity-70 text-[9px] shrink-0 font-mono">
                                    {b.unitId || b.bedCode}
                                  </span>
                                </div>
                              );
                            })}

                            {/* Overflow indicator if > 3 bookings on that day */}
                            {cell.activeBookings.length > 3 && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setSelectedBookingInfo({
                                    roomName: 'All Hostel Rooms',
                                    dateStr: cell.dateStr,
                                    bookings: cell.activeBookings
                                  });
                                }}
                                className="text-[9px] font-bold text-amber-800 hover:text-amber-950 px-1 py-0.2 rounded hover:underline cursor-pointer block w-full text-left"
                              >
                                + {cell.activeBookings.length - 3} more bookings...
                              </button>
                            )}
                          </div>

                          {/* Cell Bottom: Click to Book button on hover */}
                          <div className="pt-1 flex items-center justify-between text-[10px]">
                            {cell.arrivals.length > 0 ? (
                              <span className="text-[9px] text-emerald-700 font-semibold" title={`${cell.arrivals.length} arrivals scheduled`}>
                                ↓ {cell.arrivals.length} arr
                              </span>
                            ) : cell.departures.length > 0 ? (
                              <span className="text-[9px] text-slate-500" title={`${cell.departures.length} departures scheduled`}>
                                ↑ {cell.departures.length} dep
                              </span>
                            ) : <span />}

                            <button
                              onClick={() => handleOpenNewModal(undefined, cell.dateStr)}
                              className="text-[10px] font-bold text-amber-800 hover:text-amber-950 opacity-0 group-hover:opacity-100 transition flex items-center space-x-0.5 cursor-pointer bg-white/80 px-1 rounded shadow-2xs"
                              title={`Create booking for ${cell.dateStr}`}
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>Book</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#f1ede4] text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex items-center space-x-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        <span>Checked-in Guest</span>
                      </span>
                      <span className="flex items-center space-x-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <span>Confirmed Booking</span>
                      </span>
                      <span className="flex items-center space-x-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <span>Tentative / Other</span>
                      </span>
                      <span className="flex items-center space-x-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-[#fdbe4e]" />
                        <span>Current Day (Today)</span>
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      Click any guest chip to view details • Click <strong>Book</strong> to create a stay
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* VIEW 2: DAY VIEW (FRONT DESK SCHEDULE & BED INVENTORY)    */}
              {/* ========================================================= */}
              {calendarView === 'day' && (
                <div className="space-y-4">
                  {/* Daily KPI Metrics Header */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 text-xs">
                        <span>Total Occupancy</span>
                        <Bed className="w-4 h-4 text-[#fdbe4e]" />
                      </div>
                      <div className="text-xl font-bold font-mono text-slate-900">
                        {dayOccupiedBedsCount} <span className="text-xs font-normal text-slate-400">/ 16 beds</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {Math.round((dayOccupiedBedsCount / 16) * 100)}% hostel occupancy rate
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 text-xs">
                        <span>Arrivals Today</span>
                        <LogIn className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="text-xl font-bold font-mono text-emerald-700">
                        {dayArrivals.length} <span className="text-xs font-normal text-slate-400">check-ins</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {dayArrivals.filter(r => r.status.toLowerCase() === 'checked-in').length} already arrived
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 text-xs">
                        <span>Departures Today</span>
                        <LogOut className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="text-xl font-bold font-mono text-amber-800">
                        {dayDepartures.length} <span className="text-xs font-normal text-slate-400">check-outs</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {dayDepartures.filter(r => r.status.toLowerCase() === 'checked-out').length} completed
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 text-xs">
                        <span>Vacant Beds</span>
                        <Sparkles className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="text-xl font-bold font-mono text-slate-900">
                        {Math.max(0, 16 - dayOccupiedBedsCount)}{' '}
                        <span className="text-xs font-normal text-slate-400">beds ready</span>
                      </div>
                      <div className="text-[11px] text-emerald-700 font-semibold">
                        Available for walk-in bookings
                      </div>
                    </div>
                  </div>

                  {/* Room-by-room Bed Schedule for Selected Date */}
                  <div className="space-y-4">
                    {HOSTEL_ROOMS.map(room => {
                      const roomFullName = `${room.name} (${room.roomCode})`;
                      // Bookings occupying this room on selected date
                      const roomBookings = dayActiveReservations.filter(r =>
                        r.room.toLowerCase().includes(room.name.toLowerCase())
                      );
                      const roomOccupiedBeds = roomBookings.reduce((sum, r) => sum + (r.bedsCount || 1), 0);
                      const roomFreeBeds = Math.max(0, room.capacity - roomOccupiedBeds);

                      return (
                        <div key={room.id} className="bg-white rounded-2xl border border-[#e8e4dc] p-4 sm:p-5 shadow-2xs space-y-3">
                          {/* Room Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#f0ede6]">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center font-bold font-serif text-[#0d1726]">
                                {room.name.charAt(0)}
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <h3 className="font-bold font-serif text-slate-900 text-sm">{room.name}</h3>
                                  <span className="text-xs text-slate-400 font-mono">{room.roomCode}</span>
                                  <span className="text-xs text-slate-500">• {room.type}</span>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  Rate: ${room.rate} / night (TZS 52,900)
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              <span
                                className={`text-xs px-2.5 py-1 rounded-xl font-bold font-mono ${
                                  roomFreeBeds === 0
                                    ? 'bg-rose-100 text-rose-900 border border-rose-300'
                                    : 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                                }`}
                              >
                                {roomOccupiedBeds} / {room.capacity} Beds Booked ({roomFreeBeds} Free)
                              </span>
                            </div>
                          </div>

                          {/* Individual Beds Breakdown */}
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                            {room.units.map(unit => {
                              // Find reservation occupying this specific bed code
                              const occupant = roomBookings.find(
                                r => (r.unitId === unit.id || r.bedCode === unit.id || r.bedCode === `${room.name.charAt(0)}-ALL` || r.unitId === `${room.name.charAt(0)}-ALL`)
                              );

                              if (occupant) {
                                const isCheckedIn = occupant.status.toLowerCase() === 'checked-in';
                                const isConfirmed = occupant.status.toLowerCase() === 'confirmed';

                                return (
                                  <div
                                    key={unit.id}
                                    className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2 hover:bg-amber-50 transition"
                                  >
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <span className="font-mono text-xs font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded border border-[#e8e4dc]">
                                          {unit.id}
                                        </span>
                                        <span className="text-[11px] text-slate-500 ml-1.5">
                                          {unit.place}
                                        </span>
                                      </div>
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                          isCheckedIn
                                            ? 'bg-blue-100 text-blue-900'
                                            : isConfirmed
                                            ? 'bg-emerald-100 text-emerald-900'
                                            : 'bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        {occupant.status}
                                      </span>
                                    </div>

                                    <div>
                                      <h4 className="font-bold text-xs text-slate-900">{occupant.guestName}</h4>
                                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                        ID: {occupant.id} • {occupant.guestId || 'No guest ID'}
                                      </p>
                                      <p className="text-[10px] text-slate-600 mt-1">
                                        Dates: {occupant.checkIn} → {occupant.checkOut} ({occupant.nights}n)
                                      </p>
                                      {occupant.balanceDue > 0 && (
                                        <p className="text-[10px] text-rose-700 font-semibold mt-0.5">
                                          Balance Due: ${occupant.balanceDue}
                                        </p>
                                      )}
                                    </div>

                                    {/* Front Desk Quick Actions for Occupant */}
                                    <div className="flex items-center space-x-1.5 pt-1 border-t border-amber-200/60">
                                      {isConfirmed && (
                                        <button
                                          onClick={() => handleCheckIn(occupant.id)}
                                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center space-x-1"
                                        >
                                          <Check className="w-3 h-3" />
                                          <span>Check In</span>
                                        </button>
                                      )}
                                      {isCheckedIn && (
                                        <button
                                          onClick={() => handleCheckOut(occupant.id)}
                                          className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center space-x-1"
                                        >
                                          <LogOut className="w-3 h-3" />
                                          <span>Check Out</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleOpenEditModal(occupant)}
                                        className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-[#e8e4dc] rounded-lg text-[10px] font-semibold transition cursor-pointer"
                                      >
                                        Edit / Folio
                                      </button>
                                    </div>
                                  </div>
                                );
                              }

                              // Vacant Bed Card
                              return (
                                <div
                                  key={unit.id}
                                  className="p-3.5 rounded-xl border border-dashed border-[#e8e4dc] bg-[#faf8f5] hover:bg-white transition flex flex-col justify-between space-y-2.5 group"
                                >
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <span className="font-mono text-xs font-bold text-slate-700 bg-white px-1.5 py-0.5 rounded border border-[#e8e4dc]">
                                        {unit.id}
                                      </span>
                                      <span className="text-[11px] text-slate-500 ml-1.5">
                                        {unit.place}
                                      </span>
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      Vacant
                                    </span>
                                  </div>

                                  <div className="text-xs text-slate-500">
                                    <span>Ready for guest check-in</span>
                                    <span className="block text-[11px] font-mono text-slate-400">$20 / night</span>
                                  </div>

                                  <button
                                    onClick={() => {
                                      handleOpenNewModal(roomFullName, selectedDayStr);
                                      setFormData(prev => ({
                                        ...prev,
                                        room: roomFullName,
                                        bedCode: unit.id,
                                        checkIn: selectedDayStr
                                      }));
                                    }}
                                    className="w-full py-1.5 bg-white group-hover:bg-[#fdbe4e] text-slate-700 group-hover:text-[#0d1726] border border-[#e8e4dc] group-hover:border-[#ebb043] font-bold text-[11px] rounded-lg shadow-2xs transition flex items-center justify-center space-x-1 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Book This Bed</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* VIEW 3: 14-DAY TIMELINE MATRIX                            */}
              {/* ========================================================= */}
              {calendarView === 'timeline' && (
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
                            const isTodayDate = date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];

                            return (
                              <th
                                key={i}
                                className={`py-2 px-2 text-center min-w-[50px] ${
                                  isTodayDate ? 'bg-amber-50 rounded-t-lg' : ''
                                }`}
                              >
                                <span className={`block text-[10px] font-normal ${isTodayDate ? 'text-amber-800 font-bold' : 'text-slate-400'}`}>
                                  {dayNames[date.getDay()]}
                                </span>
                                <span className={`block text-xs font-bold font-mono ${isTodayDate ? 'text-amber-950 font-black' : 'text-slate-800'}`}>
                                  {date.getDate()}
                                </span>
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
                                      setSelectedBookingInfo({
                                        roomName: `${room.name} (${room.roomCode})`,
                                        dateStr: dateStr,
                                        bookings: activeReservationsOnDay
                                      });
                                    } else {
                                      handleOpenNewModal(`${room.name} (${room.roomCode})`, dateStr);
                                    }
                                  }}
                                  className={`py-2 px-1 text-center cursor-pointer transition select-none ${cellStyle}`}
                                  title={
                                    activeReservationsOnDay.length > 0
                                      ? `Click to view bookings for ${room.name} on ${dateStr}`
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
              )}

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
                  Cloud Database & Spreadsheet Integrations
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Synchronize your reservations across Firebase Firestore Cloud Database and your Google Sheets booking spreadsheet.
                </p>
              </div>

              {/* Firebase Cloud Database Card */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-6 shadow-2xs space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                      <Flame className="w-6 h-6 text-[#fdbe4e]" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-bold text-sm text-slate-900 font-serif">Firebase Firestore Database</h3>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Connected</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        High-availability cloud persistence for reservations, guest records, and real-time multi-device sync.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handlePullFromFirestore}
                      disabled={isFirebaseSyncing}
                      className="px-3.5 py-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isFirebaseSyncing ? 'animate-spin' : ''}`} />
                      <span>Pull from Cloud</span>
                    </button>
                    <button
                      onClick={handleSyncAllToFirestore}
                      disabled={isFirebaseSyncing}
                      className="px-3.5 py-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>{isFirebaseSyncing ? 'Syncing...' : 'Sync All to Cloud'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-[#f1ede4] text-xs">
                  <div className="bg-[#faf8f5] p-3 rounded-xl border border-[#ede9e1]">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Cloud Project</span>
                    <span className="font-mono text-slate-800 font-semibold text-[11px] truncate block">gen-lang-client-0837479015</span>
                  </div>
                  <div className="bg-[#faf8f5] p-3 rounded-xl border border-[#ede9e1]">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Firestore Region</span>
                    <span className="font-mono text-slate-800 font-semibold text-[11px]">europe-west1</span>
                  </div>
                  <div className="bg-[#faf8f5] p-3 rounded-xl border border-[#ede9e1]">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Real-Time Sync</span>
                    <span className="text-emerald-700 font-semibold text-[11px]">Active (onSnapshot enabled)</span>
                  </div>
                </div>
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
                        className="px-4 py-2 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-2 cursor-pointer"
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
                          className="w-full bg-white border border-[#e8e4dc] text-xs font-medium rounded-xl px-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                            className="w-full bg-white border border-[#e8e4dc] text-xs font-mono rounded-xl pl-8 pr-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                          />
                          <LinkIcon className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
                        </div>
                        <button
                          onClick={() => handleConnectManualSheet()}
                          disabled={isLoadingSheets}
                          className="px-4 py-2.5 bg-[#0d1726] hover:bg-[#1b2b45] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5 text-[#fdbe4e]" />
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
                          className="w-full bg-[#faf8f5] border border-[#e8e4dc] text-xs font-medium rounded-xl px-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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

                    {/* Auto-Sync & Manual Controls Bar */}
                    <div className="bg-[#faf8f5] p-4 rounded-xl border border-[#ede9e1] space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center space-x-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${autoSyncInterval !== 'off' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                          <span className="font-bold text-xs text-slate-800">
                            Bidirectional Synchronization:
                          </span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            {autoSyncInterval !== 'off'
                              ? `Auto-syncing every ${autoSyncInterval}s (Next in ${autoSyncSecondsLeft}s)`
                              : 'Manual sync mode'}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <label className="text-[11px] font-semibold text-slate-600">Interval:</label>
                          <select
                            value={autoSyncInterval}
                            onChange={e => {
                              const val = e.target.value as any;
                              setAutoSyncInterval(val);
                              localStorage.setItem('muh_auto_sync_interval', val);
                              triggerToast(`Auto-sync interval set to ${val === 'off' ? 'Manual' : val + 's'}`, 'info');
                            }}
                            className="bg-white border border-[#e8e4dc] rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                          >
                            <option value="15">Every 15 seconds (Fast)</option>
                            <option value="30">Every 30 seconds (Default)</option>
                            <option value="60">Every 1 minute</option>
                            <option value="off">Off (Manual only)</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <button
                          onClick={() => syncFromGoogleSheet()}
                          disabled={isSyncing || !selectedSheetId}
                          className="px-4 py-2 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                          <span>Sync with Sheet Now</span>
                        </button>

                        <button
                          onClick={() => {
                            setIsSyncTestModalOpen(true);
                            if (!isTestingSync && !syncTestReport) {
                              handleRunBidirectionalTest();
                            }
                          }}
                          disabled={isTestingSync || !selectedSheetId}
                          className="px-4 py-2 bg-[#0d1726] hover:bg-[#1b2b45] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Activity className={`w-3.5 h-3.5 text-[#fdbe4e] ${isTestingSync ? 'animate-pulse' : ''}`} />
                          <span>Run Bidirectional Sync Test</span>
                        </button>

                        <button
                          onClick={handleRepairSheetRefErrors}
                          disabled={isFixingRefErrors || !selectedSheetId}
                          className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                          title="Check all workbook tabs for formula errors"
                        >
                          <Wrench className={`w-3.5 h-3.5 text-rose-600 ${isFixingRefErrors ? 'animate-spin' : ''}`} />
                          <span>Check formulas</span>
                        </button>

                        <button
                          onClick={() => setIsAutomationsModalOpen(true)}
                          className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200/80 font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5 text-[#fdbe4e]" />
                          <span>Automations & Apps Script</span>
                        </button>

                        <button
                          onClick={() => {
                            setConfirmModal({
                              isOpen: true,
                              title: 'Sync All to Google Sheet',
                              message: `Append or update all ${reservations.length} records in your Google Sheet tab "${selectedTabName}"?`,
                              onConfirm: async () => {
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                for (const r of reservations) {
                                  await saveReservationToSheet(r, false);
                                }
                                triggerToast('All reservations synced with Google Sheet!', 'success');
                              }
                            });
                          }}
                          disabled={!selectedSheetId}
                          className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-[#e8e4dc] font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
                        >
                          Push GUI Records to Sheet
                        </button>

                        <button
                          onClick={handleFreshStartWipeAll}
                          disabled={isBatchProcessing}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                          title="Remove all booking records from both the App and the Google Sheet for a clean fresh start"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-white" />
                          <span>Fresh Start (Wipe App & Sheet Records)</span>
                        </button>
                      </div>

                      {syncMessage && (
                        <p className="text-xs text-slate-500 pt-1 flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
                          <span>{syncMessage}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Sheet Automation & Cell Features Card */}
              <div className="bg-white rounded-2xl border border-[#e8e4dc] p-6 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                      <Sparkles className="w-6 h-6 text-[#fdbe4e]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 font-serif">
                        Google Sheet Cell Automations & Dropdowns
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Direct spreadsheet editing features built for Moshi Urban Hostel bookings.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsAutomationsModalOpen(true)}
                    className="px-4 py-2 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer self-start sm:self-center"
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>View Automations & Apps Script</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#faf8f5] border border-[#ede9e1] space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <strong className="text-slate-900 font-semibold">1. Automatic Guest ID</strong>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Takes first letters of guest's first and last name, followed by a unique random number (e.g. <code>GN-4921</code>). Cannot be duplicated!
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#faf8f5] border border-[#ede9e1] space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <strong className="text-slate-900 font-semibold">2. Col I: Available Rooms Only</strong>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      When stay dates are chosen, Column I dropdown dynamically filters to list ONLY rooms that have at least one free bed!
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#faf8f5] border border-[#ede9e1] space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <strong className="text-slate-900 font-semibold">3. Col J: Available Beds Only</strong>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Selecting a room in Col I filters Column J to ONLY show unoccupied beds in that specific room for the chosen dates.
                    </p>
                  </div>
                </div>
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

          {/* ======================================================== */}
          {/* TAB 6: CHANGE LOG (PAST 3 DAYS) — ELEMENTOR-STYLE PANEL */}
          {/* ======================================================== */}
          {activeTab === 'changelog' && (
            <div className="space-y-6 animate-in fade-in duration-150 max-w-4xl">
              
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#e8e4dc] shadow-2xs">
                <div className="flex items-start space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                    <History className="w-5 h-5 text-[#fdbe4e]" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h1 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">Change Log</h1>
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold border border-amber-300">
                        Past 3 Days
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Elementor-style history timeline of all actions made to hostel bookings, guest records, and Google Sheets syncs.
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className="flex items-center space-x-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs px-3.5 py-2 rounded-xl border border-[#e8e4dc] shadow-2xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Undo last change (Ctrl+Z)"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-amber-600" />
                    <span>Undo Last</span>
                    {undoStack.length > 0 && (
                      <span className="bg-amber-100 text-amber-900 text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold">
                        {undoStack.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setConfirmModal({
                        isOpen: true,
                        title: 'Clear Change Log History',
                        message: 'Are you sure you want to clear your local change log history for the past 3 days? Active reservations will not be affected.',
                        onConfirm: () => {
                          setConfirmModal(prev => ({ ...prev, isOpen: false }));
                          setChangeLogs([]);
                          triggerToast('Cleared change log history.', 'info');
                        }
                      });
                    }}
                    className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                  >
                    Clear History
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-2xl border border-[#e8e4dc]">
                {[
                  { id: 'all', label: 'All Past 3 Days', count: changeLogs.length },
                  {
                    id: 'today',
                    label: 'Today (Oct 8)',
                    count: changeLogs.filter(c => c.timestamp.split('T')[0] === new Date().toISOString().split('T')[0]).length
                  },
                  {
                    id: 'yesterday',
                    label: 'Yesterday (Oct 7)',
                    count: changeLogs.filter(c => {
                      const y = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                      return c.timestamp.split('T')[0] === y;
                    }).length
                  },
                  {
                    id: 'older',
                    label: '2-3 Days Ago',
                    count: changeLogs.filter(c => {
                      const t = new Date().toISOString().split('T')[0];
                      const y = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                      const d = c.timestamp.split('T')[0];
                      return d !== t && d !== y;
                    }).length
                  }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setChangeLogFilter(tab.id as any)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      changeLogFilter === tab.id
                        ? 'bg-[#0d1726] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-[#faf8f5]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        changeLogFilter === tab.id
                          ? 'bg-amber-400 text-[#0d1726] font-bold'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Timeline Container */}
              <div className="space-y-4">
                {filteredChangeLogs.length === 0 ? (
                  <div className="bg-white p-12 text-center rounded-2xl border border-[#e8e4dc] space-y-2">
                    <History className="w-10 h-10 text-slate-300 mx-auto" />
                    <h3 className="font-bold text-slate-700 text-sm">No activity recorded for this filter</h3>
                    <p className="text-xs text-slate-400">
                      Changes made in the GUI or synchronized from Google Sheets will automatically appear here.
                    </p>
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-[#e8e4dc]">
                    {filteredChangeLogs.map((item, idx) => {
                      const isToday = item.timestamp.split('T')[0] === new Date().toISOString().split('T')[0];
                      const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const dateStr = new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                      // Action visual configuration
                      const actionConfigMap: Record<string, { bg: string; icon: any; label: string }> = {
                        create: {
                          bg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                          icon: Plus,
                          label: 'NEW BOOKING'
                        },
                        update: {
                          bg: 'bg-blue-100 text-blue-800 border-blue-300',
                          icon: Edit3,
                          label: 'UPDATED'
                        },
                        status_change: {
                          bg: 'bg-teal-100 text-teal-800 border-teal-300',
                          icon: CheckCircle,
                          label: 'STATUS'
                        },
                        check_in: {
                          bg: 'bg-teal-100 text-teal-800 border-teal-300',
                          icon: CheckCircle,
                          label: 'CHECK IN'
                        },
                        check_out: {
                          bg: 'bg-amber-100 text-amber-900 border-amber-300',
                          icon: LogOut,
                          label: 'CHECK OUT'
                        },
                        payment: {
                          bg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                          icon: DollarSign,
                          label: 'PAYMENT'
                        },
                        delete: {
                          bg: 'bg-rose-100 text-rose-800 border-rose-300',
                          icon: Trash2,
                          label: 'DELETED'
                        },
                        sync: {
                          bg: 'bg-purple-100 text-purple-800 border-purple-300',
                          icon: RefreshCw,
                          label: 'GOOGLE SYNC'
                        },
                        revert: {
                          bg: 'bg-indigo-100 text-indigo-800 border-indigo-300',
                          icon: RotateCcw,
                          label: 'REVERTED'
                        }
                      };

                      const actionConfig = actionConfigMap[item.action] || {
                        bg: 'bg-slate-100 text-slate-800 border-slate-300',
                        icon: Sparkles,
                        label: 'ACTION'
                      };

                      const ActionIcon = actionConfig.icon;

                      return (
                        <div key={item.id} className="relative group">
                          {/* Timeline dot */}
                          <div
                            className={`absolute -left-6 top-4 w-5 h-5 rounded-full border-2 bg-white flex items-center justify-center transition group-hover:scale-110 z-10 ${
                              item.action === 'create'
                                ? 'border-emerald-500 text-emerald-600'
                                : item.action === 'delete'
                                ? 'border-rose-500 text-rose-600'
                                : item.action === 'payment'
                                ? 'border-emerald-600 text-emerald-600'
                                : 'border-[#fdbe4e] text-amber-700'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          </div>

                          {/* Event Card */}
                          <div className="bg-white rounded-2xl border border-[#e8e4dc] p-4 shadow-2xs hover:shadow-xs hover:border-amber-300 transition space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-wider uppercase border ${actionConfig.bg}`}>
                                  {actionConfig.label}
                                </span>
                                <h3 className="font-bold text-xs text-slate-900 font-serif">
                                  {item.title}
                                </h3>
                              </div>

                              <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                                <span>{isToday ? `Today at ${timeStr}` : `${dateStr} at ${timeStr}`}</span>
                              </div>
                            </div>

                            <p className="text-xs text-slate-600 leading-relaxed">
                              {item.description}
                            </p>

                            {/* Diff summary badge if available */}
                            {item.diffSummary && (
                              <div className="text-[11px] font-mono text-slate-700 bg-[#faf8f5] px-2.5 py-1 rounded-lg border border-[#ede9e1] inline-block">
                                <span className="text-slate-400">Change:</span> <strong>{item.diffSummary}</strong>
                              </div>
                            )}

                            {/* Card Footer: Actor and Revert Button */}
                            <div className="flex items-center justify-between pt-2 border-t border-[#f2ede4] text-[11px] text-slate-400">
                              <span>Actor: <strong className="text-slate-700">{item.user}</strong></span>

                              {/* One-Click Revert Button (Like Elementor Change Log) */}
                              <button
                                onClick={() => {
                                  if (item.snapshotBefore && item.snapshotBefore.length > 0) {
                                    const snap = item.snapshotBefore;
                                    setConfirmModal({
                                      isOpen: true,
                                      title: 'Revert to this Point',
                                      message: `Revert all bookings back to the exact state before "${item.title}"?`,
                                      onConfirm: () => {
                                        setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                        const currentBefore = [...reservations];
                                        pushUndo(`Reverted: ${item.title}`, currentBefore);
                                        setReservations(snap);
                                        recordChange(
                                          'revert',
                                          `Reverted to step: ${item.title}`,
                                          `Restored bookings back to state at ${timeStr}`,
                                          item.targetId,
                                          item.guestName
                                        );
                                        triggerToast(`Reverted bookings back to before "${item.title}"!`, 'success');
                                      }
                                    });
                                  } else {
                                    triggerToast(`Reverted action "${item.title}".`, 'info');
                                  }
                                }}
                                className="flex items-center space-x-1 text-amber-800 hover:text-amber-950 font-bold hover:underline cursor-pointer bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200 transition"
                                title="Revert application state to this step"
                              >
                                <RotateCcw className="w-3 h-3 text-[#fdbe4e]" />
                                <span>Revert to this step</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                className="hover:text-[#fdbe4e] transition"
              >
                info@moshiurban.co.tz
              </a>
              <a
                href="https://moshiurban.co.tz"
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-1 text-slate-700 hover:text-[#fdbe4e] font-medium transition"
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
                    onChange={e => handleGuestNameChange(e.target.value)}
                    placeholder="e.g. Godwin Njau"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Auto-creates ID: 1st letters of first & last name + unique random number
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-700">Guest ID</label>
                    <button
                      type="button"
                      onClick={handleRollGuestId}
                      title="Roll fresh unique random ID"
                      className="text-[10px] font-semibold text-amber-800 hover:text-amber-950 flex items-center space-x-1 cursor-pointer bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 transition"
                    >
                      <Dices className="w-3 h-3 text-[#fdbe4e]" />
                      <span>Roll</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formData.guestId}
                    onChange={e => setFormData(prev => ({ ...prev, guestId: e.target.value }))}
                    placeholder="e.g. GN-4921"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-mono font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="e.g. 255756200540"
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  />
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Check-out *</label>
                  <input
                    type="date"
                    required
                    value={formData.checkOut}
                    onChange={e => handleDateChange(formData.checkIn, e.target.value)}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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

              {/* Dynamic Room & Bed Code with Live Availability Filtering */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-700">Room Category *</label>
                    <span className="text-[10px] text-emerald-700 font-medium">Availability for dates</span>
                  </div>
                  <select
                    value={formData.room}
                    onChange={e => {
                      const roomName = e.target.value;
                      const avail = modalAvailability[roomName];
                      const firstAvailableBed = avail?.availableBeds[0]?.id;
                      const roomObj = HOSTEL_ROOMS.find(r => roomName.includes(r.name));
                      const defaultBed = firstAvailableBed || roomObj?.units[0]?.id || 'M-S1';
                      setFormData(prev => ({
                        ...prev,
                        room: roomName,
                        bedCode: defaultBed
                      }));
                    }}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  >
                    {HOSTEL_ROOMS.map(room => {
                      const fullName = `${room.name} (${room.roomCode})`;
                      const avail = modalAvailability[fullName] || modalAvailability[room.name];
                      const freeCount = avail?.availableBedsCount ?? room.capacity;
                      const isFull = freeCount <= 0;
                      return (
                        <option key={room.id} value={fullName} disabled={isFull}>
                          {fullName} {isFull ? '• [FULL - 0 beds free]' : `• (${freeCount} of ${room.capacity} beds free)`}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-700">Available Bed Code *</label>
                    <span className="text-[10px] text-slate-500 font-medium">Unoccupied only</span>
                  </div>
                  <select
                    value={formData.bedCode}
                    onChange={e => setFormData(prev => ({ ...prev, bedCode: e.target.value }))}
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                  >
                    {(() => {
                      const avail = modalAvailability[formData.room];
                      const availableBeds = avail?.availableBeds || [];
                      if (availableBeds.length === 0) {
                        return <option value="" disabled>No beds available in this room for these dates</option>;
                      }
                      return availableBeds.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.id} — {u.place} (Available)
                        </option>
                      ));
                    })()}
                  </select>
                </div>
              </div>

              {/* Bed Occupancy Alert / Note if any beds are occupied for these dates */}
              {(() => {
                const avail = modalAvailability[formData.room];
                if (avail && avail.occupiedBeds.length > 0) {
                  return (
                    <div className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start space-x-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-semibold">Occupied in {formData.room} for selected dates:</span>{' '}
                        {avail.occupiedBeds.map(b => `${b.id} (${b.guestName} until ${b.checkOut})`).join(', ')}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                  className="w-full bg-[#faf8f5] border border-[#e8e4dc] rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
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
                    className="px-5 py-2 text-xs font-bold text-[#0d1726] bg-[#fdbe4e] hover:bg-[#ebb043] rounded-xl shadow-xs transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
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
              <div className="p-2.5 bg-amber-50 rounded-xl text-[#fdbe4e]">
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
                className="px-4 py-1.5 text-xs font-bold text-[#0d1726] bg-[#fdbe4e] hover:bg-[#ebb043] rounded-xl shadow-xs cursor-pointer"
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
                      className="px-3.5 py-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold text-xs rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
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

      {/* GOOGLE SHEETS AUTOMATIONS & APPS SCRIPT ENGINE MODAL */}
      {isAutomationsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-[#e8e4dc] my-6 animate-in fade-in zoom-in-95 duration-200 space-y-4">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-[#f1ede4]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-[#fdbe4e] flex items-center justify-center">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-serif text-slate-900">
                    Google Sheets Smart Automations & Sync Engine
                  </h3>
                  <p className="text-xs text-slate-500">
                    Auto-generated unique Guest IDs and dynamic availability dropdowns for Moshi Urban Hostel
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAutomationsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-200 space-x-2">
              <button
                onClick={() => setAutomationsTab('setup')}
                className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                  automationsTab === 'setup'
                    ? 'border-[#fdbe4e] text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                ⚡ 1-Click API Setup
              </button>
              <button
                onClick={() => setAutomationsTab('script')}
                className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                  automationsTab === 'script'
                    ? 'border-[#fdbe4e] text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                📜 Apps Script (Live Cells)
              </button>
              <button
                onClick={() => setAutomationsTab('audit')}
                className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                  automationsTab === 'audit'
                    ? 'border-[#fdbe4e] text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                🔍 Health & Audit
              </button>
            </div>

            {/* TAB 1: 1-Click API Setup */}
            {automationsTab === 'setup' && (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-[#faf8f5] rounded-xl border border-[#ede9e1] space-y-2">
                  <h4 className="font-bold text-slate-900">Automated Direct Setup via Google Sheets API</h4>
                  <p className="text-slate-600 leading-relaxed">
                    Clicking the button below directly configures your connected spreadsheet with:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-600">
                    <li>Creates background <code>_Hostel_Config</code> sheet containing all hostel rooms and beds.</li>
                    <li>Configures Data Validation Dropdowns on <strong>Column I (Select Room)</strong> and <strong>Column J (Select Bed)</strong>.</li>
                    <li>Configures Dropdowns on <strong>Column K (Booking Status)</strong>, <strong>Column F (Platform)</strong>, and <strong>Column L (Currency)</strong>.</li>
                    <li>Enforces proper column widths and data formats.</li>
                  </ul>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 flex items-center justify-between">
                  <div>
                    <span className="font-bold block">Target Spreadsheet:</span>
                    <span className="text-[11px] font-mono text-amber-800">{selectedSheetName || selectedSheetId || 'None selected'}</span>
                  </div>
                  <button
                    onClick={handleConfigureAutomations}
                    disabled={isConfiguringAutomations || !selectedSheetId}
                    className="px-4 py-2 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isConfiguringAutomations ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Applying...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Apply Automations via API</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Apps Script (Live Cells onEdit) */}
            {automationsTab === 'script' && (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 space-y-1.5">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <strong className="font-bold">Real-Time In-Cell Automation (Apps Script onEdit)</strong>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    When typing directly in Google Sheets cells, this script handles:
                    <br />• <strong>Col B (Guest Name):</strong> Auto-generates unique Guest ID in Col E (e.g. <code>GN-4921</code>).
                    <br />• <strong>Col I (Room Selection):</strong> Dropdown updates in real time to ONLY list available rooms.
                    <br />• <strong>Col J (Bed Selection):</strong> Dropdown updates to ONLY list free beds in the selected room.
                  </p>
                </div>

                {/* 3 Steps */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-[#faf8f5] border border-[#ede9e1]">
                    <span className="font-bold text-slate-800 block mb-0.5">Step 1: Open Script</span>
                    <span className="text-slate-500">In Google Sheets, click <strong>Extensions &gt; Apps Script</strong>.</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#faf8f5] border border-[#ede9e1]">
                    <span className="font-bold text-slate-800 block mb-0.5">Step 2: Paste Code</span>
                    <span className="text-slate-500">Replace any code in <code>Code.gs</code> with the code below.</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#faf8f5] border border-[#ede9e1]">
                    <span className="font-bold text-slate-800 block mb-0.5">Step 3: Save</span>
                    <span className="text-slate-500">Click <strong>Save (💾)</strong>. Edits in cells now automate instantly!</span>
                  </div>
                </div>

                {/* Code Container */}
                <div className="relative">
                  <div className="flex items-center justify-between bg-slate-800 text-slate-300 px-3.5 py-2 rounded-t-xl text-[11px] font-mono">
                    <span>Code.gs (Google Apps Script)</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
                        setCopiedScript(true);
                        triggerToast('Apps Script code copied to clipboard!', 'success');
                        setTimeout(() => setCopiedScript(false), 3000);
                      }}
                      className="flex items-center space-x-1.5 text-xs text-[#fdbe4e] hover:text-white transition font-sans font-bold cursor-pointer"
                    >
                      {copiedScript ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Script Code</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-b-xl max-h-52 overflow-y-auto font-mono text-[11px] leading-relaxed select-all">
                    {GOOGLE_APPS_SCRIPT_CODE}
                  </pre>
                </div>
              </div>
            )}

            {/* TAB 3: Health & Audit */}
            {automationsTab === 'audit' && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-3 bg-[#faf8f5] rounded-xl border border-[#ede9e1] text-center">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Total Bookings</span>
                    <span className="text-lg font-bold font-mono text-slate-900">{reservations.length}</span>
                  </div>
                  <div className="p-3 bg-[#faf8f5] rounded-xl border border-[#ede9e1] text-center">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Active Guests</span>
                    <span className="text-lg font-bold font-mono text-slate-900">
                      {reservations.filter(r => r.status.toLowerCase() !== 'cancelled').length}
                    </span>
                  </div>
                  <div className="p-3 bg-[#faf8f5] rounded-xl border border-[#ede9e1] text-center">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Guest IDs Assigned</span>
                    <span className="text-lg font-bold font-mono text-emerald-700">
                      {reservations.filter(r => Boolean(r.guestId)).length} / {reservations.length}
                    </span>
                  </div>
                  <div className="p-3 bg-[#faf8f5] rounded-xl border border-[#ede9e1] text-center">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Auto-Sync</span>
                    <span className="text-lg font-bold text-amber-900">
                      {autoSyncInterval === 'off' ? 'Off' : `${autoSyncInterval}s`}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-[#faf8f5] rounded-xl border border-[#ede9e1] space-y-2">
                  <h4 className="font-bold text-slate-900">Spreadsheet Consistency Check</h4>
                  <p className="text-slate-600 text-[11px]">
                    All bookings in the system currently match the rule: Guest IDs formatted as <code>[Initial][Initial]-[Random]</code> and bed codes mapped to valid room inventories.
                  </p>
                  <div className="pt-2 flex items-center space-x-2">
                    <button
                      onClick={() => syncFromGoogleSheet(selectedSheetId, selectedTabName, token, false)}
                      className="px-3.5 py-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] font-bold rounded-xl transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reconcile All Records Now</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="pt-3 border-t border-[#f1ede4] flex justify-end">
              <button
                type="button"
                onClick={() => setIsAutomationsModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Bidirectional Sync Health & Verification Modal */}
      {isSyncTestModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-[#ede9e1] space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#f1ede4] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#0d1726] text-[#fdbe4e] flex items-center justify-center font-bold shadow-xs">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center space-x-2">
                    <span>Bidirectional Sync Health & Verification</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Live Verification
                    </span>
                  </h3>
                  <p className="text-slate-500 text-xs">
                    Tests full bidirectional data flow: App ➔ Google Sheet creation, Sheet ➔ App reading & parsing, in-place sheet cell updates, and clean row deletion without any #REF! errors.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSyncTestModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Tab & Actions Card */}
            <div className="p-3.5 bg-[#faf8f5] rounded-2xl border border-[#ede9e1] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase block tracking-wider">Active Target</span>
                <span className="font-bold text-slate-900 text-xs font-mono">
                  {selectedSheetName || 'Google Sheet'} &gt; {selectedTabName}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleRepairSheetRefErrors}
                  disabled={isFixingRefErrors}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                  title="Check all workbook tabs without changing records"
                >
                  <Wrench className={`w-3.5 h-3.5 text-rose-600 ${isFixingRefErrors ? 'animate-spin' : ''}`} />
                  <span>Check formulas</span>
                </button>
                <button
                  type="button"
                  onClick={handleRunBidirectionalTest}
                  disabled={isTestingSync}
                  className="px-4 py-1.5 bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] rounded-xl text-xs font-bold transition cursor-pointer shadow-xs flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isTestingSync ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Run Test Suite</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Steps Progress Cards */}
            <div className="space-y-3">
              {[
                {
                  step: 1,
                  title: 'App ➔ Google Sheet: Create Test Booking',
                  description: 'Inserts test reservation row into sheet using appendReservationToSheet.',
                },
                {
                  step: 2,
                  title: 'Google Sheet ➔ App: Read & Parse Verification',
                  description: 'Reads sheet rows via Google Sheets API and verifies parsing into active app state.',
                },
                {
                  step: 3,
                  title: 'App ➔ Google Sheet: In-Place Cell Update',
                  description: 'Updates booking details in the sheet and verifies status reflection.',
                },
                {
                  step: 4,
                  title: 'Clean Row Deletion & #REF! Error Protection',
                  description: 'Clears the test booking while preserving rows and formulas, then checks every workbook tab.',
                },
              ].map(item => {
                const stepResult =
                  (syncTestReport?.steps && syncTestReport.steps[item.step - 1]) ||
                  testStepsProgress.find(s => s.step === item.step);

                const status = stepResult?.status || 'pending';
                const message = stepResult?.message || item.description;
                const duration = stepResult?.durationMs;

                return (
                  <div
                    key={item.step}
                    className={`p-3.5 rounded-2xl border transition flex items-start space-x-3.5 ${
                      status === 'success'
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : status === 'running'
                        ? 'bg-amber-50/80 border-amber-300 text-amber-950 animate-pulse'
                        : status === 'failed'
                        ? 'bg-rose-50 border-rose-200 text-rose-950'
                        : 'bg-[#faf8f5] border-[#ede9e1] text-slate-700'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : status === 'running' ? (
                        <RefreshCw className="w-5 h-5 text-amber-600 animate-spin" />
                      ) : status === 'failed' ? (
                        <AlertCircle className="w-5 h-5 text-rose-600" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-400">
                          {item.step}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs">{item.title}</span>
                        {duration !== undefined && (
                          <span className="text-[10px] font-mono text-slate-500 font-semibold">
                            {duration}ms
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{message}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Test Report Banner */}
            {syncTestReport && (
              <div
                className={`p-4 rounded-2xl border flex items-center space-x-3 text-xs ${
                  syncTestReport.success
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-900 font-medium'
                    : 'bg-rose-100 border-rose-300 text-rose-900'
                }`}
              >
                {syncTestReport.success ? (
                  <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
                )}
                <div>
                  <strong className="block font-bold">
                    {syncTestReport.success ? 'Bidirectional Sync Verified 100%' : 'Verification Incomplete'}
                  </strong>
                  <span>{syncTestReport.overallMessage}</span>
                </div>
              </div>
            )}

            {/* Repair Stats Banner if triggered */}
            {sheetRepairStats && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{sheetRepairStats.message}</span>
              </div>
            )}

            {/* Modal Footer */}
            <div className="pt-3 border-t border-[#f1ede4] flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Bidirectional updates are guarded against formula #REF! errors.
              </span>
              <button
                type="button"
                onClick={() => setIsSyncTestModalOpen(false)}
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

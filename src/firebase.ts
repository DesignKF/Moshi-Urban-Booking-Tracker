import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User as FirebaseUser
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  runTransaction
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { type Reservation, type PaymentTransaction, type BedSchedule } from './types';
import { checkNewBookingConflict, getNightsList, getRelatedBedCodes, normalizeRoomName } from './bookingConflicts';

// Initialize Firebase App safely as singleton
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: Initialize Firestore with custom databaseId from firebase-applet-config.json
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on app startup as instructed by Firebase integration guidelines
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase Firestore connection verified.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    } else {
      console.warn('Firestore connection check:', error);
    }
    return false;
  }
}

export type UserRoleType = 'admin' | 'manager' | 'staff';

export interface AppUserAccount {
  email: string;
  role: UserRoleType;
  displayName?: string;
  status?: 'active' | 'suspended';
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  uid?: string;
}

// 1. Admins: wolfgodie@gmail.com, designkilifair@gmail.com, gdnjau@gmail.com
export const SYSTEM_ADMIN_EMAILS: string[] = [
  'wolfgodie@gmail.com',
  'designkilifair@gmail.com',
  'gdnjau@gmail.com'
];

// 2. Property Manager: moshiurbanproperty@gmail.com
export const SYSTEM_PROPERTY_MANAGER_EMAILS: string[] = [
  'moshiurbanproperty@gmail.com'
];

// Backwards-compatible export
export const AUTHORIZED_ADMIN_EMAILS = SYSTEM_ADMIN_EMAILS;

// In-memory / cached dynamic roles loaded from Firestore
let cachedUserRoles: Map<string, AppUserAccount> = new Map();

export function updateCachedUserRoles(roles: AppUserAccount[]) {
  const map = new Map<string, AppUserAccount>();
  for (const r of roles) {
    if (r.email) {
      map.set(r.email.toLowerCase().trim(), r);
    }
  }
  cachedUserRoles = map;
}

export function getUserRole(email?: string | null): UserRoleType | 'viewer' {
  if (!email) return 'viewer';
  const normEmail = email.toLowerCase().trim();

  // 1. Dynamic role from Firestore if exists
  const dynamicAccount = cachedUserRoles.get(normEmail);
  if (dynamicAccount) {
    if (dynamicAccount.status === 'suspended') return 'viewer';
    return dynamicAccount.role;
  }

  // 2. Built-in system administrator emails
  if (SYSTEM_ADMIN_EMAILS.includes(normEmail)) {
    return 'admin';
  }

  // 3. Built-in property manager email
  if (SYSTEM_PROPERTY_MANAGER_EMAILS.includes(normEmail)) {
    return 'manager';
  }

  // 4. Default for other signed-in users: unapproved accounts receive 'viewer' (pending admin approval)
  return 'viewer';
}

export function isAuthorizedAdminEmail(email?: string | null): boolean {
  return getUserRole(email) === 'admin';
}

export function isAuthorizedPropertyManagerOrAdmin(email?: string | null): boolean {
  const role = getUserRole(email);
  return role === 'admin' || role === 'manager';
}

export async function recordUserProfile(user: FirebaseUser): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const docRef = doc(db, 'users', user.uid);
    const role = getUserRole(user.email);
    await setDoc(docRef, {
      uid: user.uid,
      email: user.email?.toLowerCase().trim() || '',
      displayName: user.displayName || '',
      role: role,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// User Account Management in Firestore for Admin Panel
export async function fetchUserAccountsFromFirestore(): Promise<AppUserAccount[]> {
  const path = 'user_roles';
  try {
    const q = query(collection(db, path));
    const snapshot = await getDocs(q);
    const dbAccounts: AppUserAccount[] = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as AppUserAccount;
      if (data.email) {
        dbAccounts.push({
          ...data,
          email: data.email.toLowerCase().trim()
        });
      }
    });

    const map = new Map<string, AppUserAccount>();

    // Initial default accounts
    map.set('wolfgodie@gmail.com', {
      email: 'wolfgodie@gmail.com',
      role: 'admin',
      displayName: 'Wolfgodie (Co-Admin)',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'system'
    });

    map.set('designkilifair@gmail.com', {
      email: 'designkilifair@gmail.com',
      role: 'admin',
      displayName: 'Kilifair Design (Lead Admin)',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'system'
    });

    map.set('gdnjau@gmail.com', {
      email: 'gdnjau@gmail.com',
      role: 'admin',
      displayName: 'GD Njau (Co-Admin)',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'system'
    });

    map.set('moshiurbanproperty@gmail.com', {
      email: 'moshiurbanproperty@gmail.com',
      role: 'manager',
      displayName: 'Moshi Urban Property (Property Manager)',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'system'
    });

    // Merge Firestore database entries
    for (const acc of dbAccounts) {
      map.set(acc.email, acc);
    }

    const merged = Array.from(map.values());
    updateCachedUserRoles(merged);
    return merged;
  } catch (error) {
    console.warn('Could not list user_roles from Firestore (offline or unauthenticated):', error);
    const fallback: AppUserAccount[] = [
      { email: 'wolfgodie@gmail.com', role: 'admin', displayName: 'Wolfgodie (Admin)', status: 'active', updatedBy: 'system' },
      { email: 'designkilifair@gmail.com', role: 'admin', displayName: 'Kilifair Design (Admin)', status: 'active', updatedBy: 'system' },
      { email: 'gdnjau@gmail.com', role: 'admin', displayName: 'GD Njau (Admin)', status: 'active', updatedBy: 'system' },
      { email: 'moshiurbanproperty@gmail.com', role: 'manager', displayName: 'Moshi Urban Property (Manager)', status: 'active', updatedBy: 'system' }
    ];
    updateCachedUserRoles(fallback);
    return fallback;
  }
}

export async function saveUserAccountToFirestore(account: AppUserAccount, currentAdminEmail: string): Promise<void> {
  const normEmail = account.email.toLowerCase().trim();
  const path = `user_roles/${normEmail}`;
  try {
    const docRef = doc(db, 'user_roles', normEmail);
    const dataToSave: AppUserAccount = {
      email: normEmail,
      role: account.role,
      displayName: account.displayName?.trim() || normEmail.split('@')[0],
      status: account.status || 'active',
      updatedAt: new Date().toISOString(),
      createdAt: account.createdAt || new Date().toISOString(),
      updatedBy: currentAdminEmail
    };
    await setDoc(docRef, dataToSave, { merge: true });
    cachedUserRoles.set(normEmail, dataToSave);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteUserAccountFromFirestore(email: string): Promise<void> {
  const normEmail = email.toLowerCase().trim();
  const path = `user_roles/${normEmail}`;
  try {
    const docRef = doc(db, 'user_roles', normEmail);
    await deleteDoc(docRef);
    cachedUserRoles.delete(normEmail);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function seedDefaultAccountsToFirestore(currentAdminEmail: string): Promise<number> {
  const accounts: AppUserAccount[] = [
    { email: 'wolfgodie@gmail.com', role: 'admin', displayName: 'Wolfgodie (Admin)', status: 'active' },
    { email: 'designkilifair@gmail.com', role: 'admin', displayName: 'Kilifair Design (Lead Admin)', status: 'active' },
    { email: 'gdnjau@gmail.com', role: 'admin', displayName: 'GD Njau (Admin)', status: 'active' },
    { email: 'moshiurbanproperty@gmail.com', role: 'manager', displayName: 'Moshi Urban Property (Manager)', status: 'active' }
  ];
  let count = 0;
  for (const acc of accounts) {
    await saveUserAccountToFirestore(acc, currentAdminEmail);
    count++;
  }
  return count;
}

// Authentication Helpers
export async function signInWithGoogleFirebase(): Promise<FirebaseUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err: any) {
    console.error('Firebase Google Sign-in error:', err);
    throw err;
  }
}

export async function signOutFirebase(): Promise<void> {
  await fbSignOut(auth);
}

// Reservation Firestore Operations
export async function fetchReservationsFromFirestore(): Promise<Reservation[]> {
  const path = 'reservations';
  try {
    const q = query(collection(db, path));
    const snapshot = await getDocs(q);
    const list: Reservation[] = [];
    snapshot.forEach(docSnap => {
      list.push(docSnap.data() as Reservation);
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Collision-free booking ID allocator:
 * Uses atomic sequence counter in Firestore transaction with database uniqueness verification
 */
export async function allocateNextBookingId(existingReservations: Reservation[] = []): Promise<string> {
  const counterRef = doc(db, 'counters', 'booking_sequence');
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      let nextNum = 101;
      if (snap.exists()) {
        const val = snap.data().lastNumber;
        if (typeof val === 'number') nextNum = val + 1;
      } else {
        // Derive highest existing numeric ID
        for (const r of existingReservations) {
          const num = parseInt(r.id.replace(/\D/g, ''), 10);
          if (!isNaN(num) && num >= nextNum) nextNum = num + 1;
        }
      }

      // Check collision against actual reservations table in database
      let candidateId = `MU-${nextNum}`;
      let resSnap = await tx.get(doc(db, 'reservations', candidateId));
      while (resSnap.exists()) {
        nextNum++;
        candidateId = `MU-${nextNum}`;
        resSnap = await tx.get(doc(db, 'reservations', candidateId));
      }

      tx.set(counterRef, {
        id: 'booking_sequence',
        lastNumber: nextNum,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return candidateId;
    });
  } catch (error: any) {
    console.error('Authoritative sequence counter allocation failure:', error);
    throw new Error(`Failed to allocate sequential booking ID from database counter: ${error?.message || 'Database transaction error'}. Please verify connection and administrator permissions.`);
  }
}

export interface InitialPaymentOption {
  amount: number;
  currency?: string;
  method?: string;
  notes?: string;
  idempotencyKey?: string;
}

/**
 * Authoritative Firestore Transaction:
 * - Reads existing reservation footprint and union of all affected bed schedules in the Read Phase
 * - Authoritatively checks for double bookings or whole-room collisions across all occupied nights
 * - Atomically cleans up outdated allocations from previous beds/dates when modified or cancelled
 * - Reserves all underlying physical beds for whole-room bookings
 * - Prevents initial deposit double-counting: atomic reservation creation with optional initial deposit
 * - Emits traceable audit records
 */
export async function saveReservationToFirestore(
  res: Reservation,
  initialPayment?: InitialPaymentOption
): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Authentication required: please sign in to save reservations.');
  }
  const role = getUserRole(auth.currentUser.email);
  if (role === 'viewer') {
    throw new Error('Permission denied: Your account is pending administrator approval or lacks reservation privileges.');
  }

  // 1. Validation checks
  if (!res.id || !res.guestName || !res.room || !res.bedCode || !res.checkIn || !res.checkOut) {
    throw new Error('Validation error: missing required reservation fields.');
  }
  if (res.checkIn >= res.checkOut) {
    throw new Error(`Invalid date range: check-in (${res.checkIn}) must be before check-out (${res.checkOut}).`);
  }

  const reservationPath = `reservations/${res.id}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser.email || 'system';
  const isCancelled = (res.status || '').toLowerCase().includes('cancel');

  const newNights = getNightsList(res.checkIn, res.checkOut);
  const newBeds = getRelatedBedCodes(res.room, res.bedCode);

  try {
    await runTransaction(db, async (tx) => {
      // Step A: Read Phase - All database reads MUST precede any writes in a Firestore transaction
      const resDocRef = doc(db, 'reservations', res.id);
      const existingResSnap = await tx.get(resDocRef);

      let oldBeds: string[] = [];
      let isNew = !existingResSnap.exists();
      let canonicalPaid = 0;
      let canonicalBalance = res.totalAmount || 0;

      if (existingResSnap.exists()) {
        const existingRes = existingResSnap.data() as Reservation;
        oldBeds = getRelatedBedCodes(existingRes.room, existingRes.bedCode);
        canonicalPaid = existingRes.paidAmount || 0;
        canonicalBalance = Math.max(0, Math.round(((res.totalAmount ?? existingRes.totalAmount) - canonicalPaid + Number.EPSILON) * 100) / 100);
      }

      // Compute union of all affected bed schedules to read and lock
      const allAffectedBeds = Array.from(new Set([...oldBeds, ...newBeds]));
      const bedScheduleSnaps = await Promise.all(
        allAffectedBeds.map(bCode => tx.get(doc(db, 'bed_schedules', bCode)))
      );

      const bedScheduleMap = new Map<string, BedSchedule>();
      for (let i = 0; i < allAffectedBeds.length; i++) {
        const snap = bedScheduleSnaps[i];
        if (snap.exists()) {
          bedScheduleMap.set(allAffectedBeds[i], snap.data() as BedSchedule);
        }
      }

      // Check initial payment idempotency if requested
      const paymentId = initialPayment
        ? (initialPayment.idempotencyKey || `PAY-${res.id}-deposit`)
        : null;
      let existingPaySnap = null;
      if (paymentId) {
        existingPaySnap = await tx.get(doc(db, 'payments', paymentId));
      }

      // Check authoritative inventory initialization status
      const invStatusSnap = await tx.get(doc(db, 'counters', 'inventory_status'));

      // Step B: Conflict verification across all proposed nights on all proposed beds
      if (invStatusSnap.exists() && invStatusSnap.data()?.initialized === false) {
        throw new Error('Inventory safety block: Bed inventory initialization is pending. Reconcile historical reservations before booking.');
      }

      if (!isCancelled) {
        for (const bCode of newBeds) {
          const sched = bedScheduleMap.get(bCode);
          if (sched && sched.allocations) {
            for (const night of newNights) {
              const existingAlloc = sched.allocations[night];
              if (
                existingAlloc &&
                existingAlloc.reservationId !== res.id &&
                !existingAlloc.status.toLowerCase().includes('cancel')
              ) {
                throw new Error(
                  `Double-booking prevented: Bed ${bCode} is already booked on ${night} by ${existingAlloc.guestName} (${existingAlloc.reservationId}).`
                );
              }
            }
          }
        }
      }

      // Step C: Write Phase - Update bed schedules
      // 1. For every affected bed, remove old allocations belonging to this reservation
      for (const bCode of allAffectedBeds) {
        const sched = bedScheduleMap.get(bCode) || { bedCode: bCode, room: res.room, allocations: {} };
        const updatedAllocations: Record<string, any> = {};

        for (const [dKey, alloc] of Object.entries(sched.allocations || {})) {
          if (alloc && (alloc as any).reservationId !== res.id) {
            updatedAllocations[dKey] = alloc;
          }
        }

        // If not cancelled and this bed is part of the new allocation footprint, write new allocations
        if (!isCancelled && newBeds.includes(bCode)) {
          for (const night of newNights) {
            updatedAllocations[night] = {
              reservationId: res.id,
              guestName: res.guestName,
              checkIn: res.checkIn,
              checkOut: res.checkOut,
              status: res.status
            };
          }
        }

        tx.set(doc(db, 'bed_schedules', bCode), {
          bedCode: bCode,
          room: res.room,
          allocations: updatedAllocations,
          updatedAt: now
        }, { merge: true });
      }

      // 2. Handle initial payment atomically if creating a new booking with deposit
      if (isNew && initialPayment && initialPayment.amount > 0 && paymentId) {
        if (!existingPaySnap || !existingPaySnap.exists()) {
          canonicalPaid = initialPayment.amount;
          canonicalBalance = Math.max(0, Math.round((res.totalAmount - canonicalPaid + Number.EPSILON) * 100) / 100);

          tx.set(doc(db, 'payments', paymentId), {
            id: paymentId,
            reservationId: res.id,
            guestId: res.guestId || `GS-${res.id.replace(/\D/g, '').padStart(4, '0')}`,
            amount: initialPayment.amount,
            currency: initialPayment.currency || res.currency || 'USD',
            type: canonicalBalance === 0 ? 'full' : 'deposit',
            method: initialPayment.method || 'BookingPlatform',
            recordedBy: userEmail,
            notes: initialPayment.notes || `Initial deposit with new booking ${res.id}`,
            createdAt: now
          });
        }
      }

      // 3. Write reservation document with canonical financial balances
      tx.set(resDocRef, {
        ...res,
        paidAmount: canonicalPaid,
        balanceDue: canonicalBalance,
        updatedAt: now
      }, { merge: true });

      // 4. Write guest profile document
      const guestId = res.guestId || `GS-${res.id.replace(/\D/g, '').padStart(4, '0')}`;
      tx.set(doc(db, 'guests', guestId), {
        id: guestId,
        name: res.guestName,
        email: res.email || '',
        phone: res.phone || '',
        loyalty: res.loyalty || 'Standard',
        notes: res.notes || '',
        updatedAt: now
      }, { merge: true });

      // 5. Traceable Audit Log
      const auditId = `LOG-${res.id}-${Date.now()}`;
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        action: isNew ? 'create_reservation' : (isCancelled ? 'cancel_reservation' : 'update_reservation'),
        targetId: res.id,
        guestName: res.guestName,
        user: userEmail,
        timestamp: now,
        diffSummary: `${isNew ? 'Created' : 'Updated'} ${res.id} for ${res.guestName} (${res.room} - ${res.bedCode}, ${res.checkIn} to ${res.checkOut})`
      });
    });

  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, reservationPath);
  }
}

/**
 * Authoritative Payment Transaction Recording:
 * - Dedicated, idempotent financial operations
 * - Reads both reservation and payment record in Read Phase
 * - If identical payment exists, returns success idempotently without double-adjusting balances
 * - Rejects conflicting payment records with same ID
 * - Atomically updates reservation paidAmount and balanceDue
 */
/**
 * Generates a stable, unique business operation idempotency key for financial transactions.
 * When a payment is retried across network disconnects, the same idempotency key is reused.
 * Two distinct payments of the exact same amount receive separate unique keys.
 */
export function generatePaymentIdempotencyKey(reservationId: string, operationType: string = 'payment'): string {
  const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `PAY-${reservationId}-${operationType}-${nonce}`;
}

export async function recordPaymentTransaction(payment: PaymentTransaction): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to record payments.');
  }
  const role = getUserRole(auth.currentUser.email);
  if (role === 'viewer') {
    throw new Error('Permission denied: Your account is pending administrator approval or lacks payment privileges.');
  }
  if (!payment.reservationId || !payment.amount || payment.amount <= 0) {
    throw new Error('Invalid payment: reservationId and positive amount are required.');
  }

  const paymentId = payment.id || generatePaymentIdempotencyKey(payment.reservationId, payment.type);
  const now = new Date().toISOString();
  const userEmail = auth.currentUser.email || 'system';

  try {
    await runTransaction(db, async (tx) => {
      const resDocRef = doc(db, 'reservations', payment.reservationId);
      const payDocRef = doc(db, 'payments', paymentId);

      // Read Phase
      const [resSnap, paySnap] = await Promise.all([
        tx.get(resDocRef),
        tx.get(payDocRef)
      ]);

      if (!resSnap.exists()) {
        throw new Error(`Cannot record payment: Reservation ${payment.reservationId} not found.`);
      }

      // Idempotency check:
      if (paySnap.exists()) {
        const existingPay = paySnap.data() as PaymentTransaction;
        if (
          existingPay.amount === payment.amount &&
          existingPay.currency === (payment.currency || 'USD') &&
          existingPay.type === payment.type &&
          existingPay.reservationId === payment.reservationId
        ) {
          // Idempotent retry: return success without modifying balances again
          return;
        }
        throw new Error(`Conflicting transaction details for payment ID ${paymentId}`);
      }

      const resData = resSnap.data() as Reservation;
      const currentPaid = resData.paidAmount || 0;
      const gross = resData.totalAmount || 0;

      const isRefund = payment.type === 'refund';
      const updatedPaid = isRefund
        ? Math.max(0, Math.round((currentPaid - payment.amount + Number.EPSILON) * 100) / 100)
        : Math.round((currentPaid + payment.amount + Number.EPSILON) * 100) / 100;
      const updatedBalance = Math.max(0, Math.round((gross - updatedPaid + Number.EPSILON) * 100) / 100);

      // Write payment document
      tx.set(payDocRef, {
        ...payment,
        id: paymentId,
        recordedBy: userEmail,
        createdAt: payment.createdAt || now
      });

      // Update reservation totals
      tx.update(resDocRef, {
        paidAmount: updatedPaid,
        balanceDue: updatedBalance,
        updatedAt: now
      });

      // Audit log
      const auditId = `LOG-PAY-${paymentId}`;
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        action: isRefund ? 'refund_payment' : 'record_payment',
        targetId: payment.reservationId,
        guestName: resData.guestName,
        user: userEmail,
        timestamp: now,
        diffSummary: `${isRefund ? 'Refunded' : 'Recorded'} ${payment.currency || 'USD'} ${payment.amount} (${payment.type})`
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payments/${paymentId}`);
  }
}

/**
 * Fetch all payment records for a given reservation from /payments
 */
export async function fetchPaymentsForReservation(reservationId: string): Promise<PaymentTransaction[]> {
  const path = 'payments';
  try {
    const q = query(collection(db, path));
    const snapshot = await getDocs(q);
    const payments: PaymentTransaction[] = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as PaymentTransaction;
      if (data.reservationId === reservationId) {
        payments.push(data);
      }
    });
    return payments;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Reconciles historical payments for a reservation from the payment ledger:
 * Computes exact sum of deposits and balance payments minus refunds.
 */
export async function reconcileReservationPayments(reservationId: string): Promise<{
  paidAmount: number;
  balanceDue: number;
  paymentsCount: number;
}> {
  const payments = await fetchPaymentsForReservation(reservationId);
  let totalPaid = 0;
  for (const p of payments) {
    if (p.type === 'refund') {
      totalPaid -= p.amount;
    } else {
      totalPaid += p.amount;
    }
  }
  totalPaid = Math.max(0, Math.round((totalPaid + Number.EPSILON) * 100) / 100);

  const resDocRef = doc(db, 'reservations', reservationId);
  const snap = await getDocFromServer(resDocRef);
  let balanceDue = 0;
  if (snap.exists()) {
    const data = snap.data() as Reservation;
    const gross = data.totalAmount || 0;
    balanceDue = Math.max(0, Math.round((gross - totalPaid + Number.EPSILON) * 100) / 100);
    await setDoc(resDocRef, {
      paidAmount: totalPaid,
      balanceDue: balanceDue,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }
  return { paidAmount: totalPaid, balanceDue, paymentsCount: payments.length };
}

export async function deleteReservationFromFirestore(reservationId: string): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Authentication required.');
  }
  if (!isAuthorizedAdminEmail(auth.currentUser.email)) {
    throw new Error('Permission denied: only Administrators can delete reservations.');
  }
  const path = `reservations/${reservationId}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser.email || 'admin';

  try {
    await runTransaction(db, async (tx) => {
      const resDocRef = doc(db, 'reservations', reservationId);
      const resSnap = await tx.get(resDocRef);
      if (!resSnap.exists()) {
        return; // Idempotent deletion
      }

      const res = resSnap.data() as Reservation;
      const relatedBeds = getRelatedBedCodes(res.room, res.bedCode);
      const schedSnaps = await Promise.all(
        relatedBeds.map(bCode => tx.get(doc(db, 'bed_schedules', bCode)))
      );

      // Clean up allocations on all related beds
      for (let i = 0; i < relatedBeds.length; i++) {
        const bCode = relatedBeds[i];
        const sSnap = schedSnaps[i];
        if (sSnap.exists()) {
          const sched = sSnap.data() as BedSchedule;
          const updatedAllocations: Record<string, any> = {};
          for (const [dKey, alloc] of Object.entries(sched.allocations || {})) {
            if (alloc && (alloc as any).reservationId !== reservationId) {
              updatedAllocations[dKey] = alloc;
            }
          }
          tx.set(doc(db, 'bed_schedules', bCode), {
            bedCode: bCode,
            allocations: updatedAllocations,
            updatedAt: now
          }, { merge: true });
        }
      }

      tx.delete(resDocRef);

      const auditId = `LOG-DEL-${reservationId}-${Date.now()}`;
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        action: 'delete_reservation',
        targetId: reservationId,
        user: userEmail,
        timestamp: now,
        diffSummary: `Deleted reservation ${reservationId} and released bed inventory`
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface RebuildSchedulesOptions {
  dryRun?: boolean;
  explicitApproval?: boolean;
  verifiedBackupTimestamp?: string;
}

export interface RebuildSchedulesResult {
  dryRun: boolean;
  success: boolean;
  written: boolean;
  blockedReason?: string;
  processedReservations: number;
  populatedBeds: number;
  historicalConflicts: string[];
}

/**
 * Rebuilds and reconciles bed schedules from canonical Firestore reservations.
 * - Defaults to dryRun: true to safely audit inventory without mutating the database
 * - If historical conflicts exist, blocks automatic write until human review
 * - Requires explicit cutover approval and verified backup timestamp before writing
 */
export async function rebuildBedSchedulesFromReservations(
  options: RebuildSchedulesOptions = {}
): Promise<RebuildSchedulesResult> {
  const dryRun = options.dryRun !== false; // Default true!
  const allReservations = await fetchReservationsFromFirestore();
  const activeReservations = allReservations.filter(r => {
    const st = (r.status || '').toLowerCase();
    return !st.includes('cancel') && r.checkIn && r.checkOut && r.checkIn < r.checkOut;
  });

  const bedAllocationsMap = new Map<string, Record<string, any>>();
  const conflicts: string[] = [];

  for (const res of activeReservations) {
    const beds = getRelatedBedCodes(res.room, res.bedCode);
    const nights = getNightsList(res.checkIn, res.checkOut);

    for (const bCode of beds) {
      if (!bedAllocationsMap.has(bCode)) {
        bedAllocationsMap.set(bCode, {});
      }
      const allocs = bedAllocationsMap.get(bCode)!;

      for (const night of nights) {
        if (allocs[night] && allocs[night].reservationId !== res.id) {
          conflicts.push(`Historical conflict on bed ${bCode} (${night}): ${allocs[night].reservationId} vs ${res.id}`);
        }
        allocs[night] = {
          reservationId: res.id,
          guestName: res.guestName,
          checkIn: res.checkIn,
          checkOut: res.checkOut,
          status: res.status
        };
      }
    }
  }

  // 1. Dry run returns report without writing
  if (dryRun) {
    return {
      dryRun: true,
      success: true,
      written: false,
      processedReservations: activeReservations.length,
      populatedBeds: bedAllocationsMap.size,
      historicalConflicts: conflicts
    };
  }

  // 2. Safety Gate: Block write if unresolved historical conflicts exist
  if (conflicts.length > 0) {
    return {
      dryRun: false,
      success: false,
      written: false,
      blockedReason: `Safety Block: Found ${conflicts.length} historical conflicts. Conflicting reservations must be resolved before writing bed schedules.`,
      processedReservations: activeReservations.length,
      populatedBeds: bedAllocationsMap.size,
      historicalConflicts: conflicts
    };
  }

  // 3. Safety Gate: Require explicit administrator cutover authorization
  if (!options.explicitApproval || !options.verifiedBackupTimestamp) {
    return {
      dryRun: false,
      success: false,
      written: false,
      blockedReason: 'Safety Block: Writing bed schedules requires explicit administrator cutover approval and a verified backup timestamp.',
      processedReservations: activeReservations.length,
      populatedBeds: bedAllocationsMap.size,
      historicalConflicts: conflicts
    };
  }

  // 4. Safe write phase only after all gates pass
  const now = new Date().toISOString();
  for (const [bCode, allocations] of bedAllocationsMap.entries()) {
    await setDoc(doc(db, 'bed_schedules', bCode), {
      bedCode: bCode,
      allocations,
      updatedAt: now
    }, { merge: true });
  }

  // Authoritative inventory initialization status in counters collection
  await setDoc(doc(db, 'counters', 'inventory_status'), {
    id: 'inventory_status',
    initialized: true,
    lastRebuiltAt: now,
    processedReservations: activeReservations.length,
    populatedBeds: bedAllocationsMap.size,
    verifiedBackupTimestamp: options.verifiedBackupTimestamp,
    updatedAt: now
  }, { merge: true });

  return {
    dryRun: false,
    success: true,
    written: true,
    processedReservations: activeReservations.length,
    populatedBeds: bedAllocationsMap.size,
    historicalConflicts: conflicts
  };
}

/**
 * Checks whether authoritative inventory schedules have been reconciled and initialized
 */
export async function getInventoryInitializationStatus(): Promise<{
  initialized: boolean;
  lastRebuiltAt?: string;
  processedReservations?: number;
  populatedBeds?: number;
}> {
  try {
    const snap = await getDoc(doc(db, 'counters', 'inventory_status'));
    if (snap.exists()) {
      return snap.data() as any;
    }
    return { initialized: false };
  } catch {
    return { initialized: false };
  }
}

// Clear all reservations from Firestore (Admin only)
export async function clearAllReservationsFromFirestore(): Promise<number> {
  if (!auth.currentUser) {
    throw new Error('Authentication required.');
  }
  if (!isAuthorizedAdminEmail(auth.currentUser.email)) {
    throw new Error('Permission denied: only Administrators can wipe reservations.');
  }
  const path = 'reservations';
  try {
    const q = query(collection(db, path));
    const snapshot = await getDocs(q);
    let count = 0;
    const promises: Promise<void>[] = [];
    snapshot.forEach(docSnap => {
      promises.push(deleteDoc(docSnap.ref));
      count++;
    });
    await Promise.all(promises);

    // Audit log
    const auditId = `LOG-WIPE-${Date.now()}`;
    await setDoc(doc(db, 'audit_logs', auditId), {
      id: auditId,
      action: 'clear_all_reservations',
      targetId: 'all',
      user: auth.currentUser.email || 'admin',
      timestamp: new Date().toISOString(),
      diffSummary: `Cleared ${count} reservations from Firestore`
    }).catch(() => {});

    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Real-time listener for reservations
export function subscribeToReservations(
  onData: (reservations: Reservation[]) => void,
  onError?: (err: Error) => void
) {
  const path = 'reservations';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: Reservation[] = [];
      snapshot.forEach(docSnap => {
        list.push(docSnap.data() as Reservation);
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e: any) {
        if (onError) onError(e);
      }
    }
  );
}

// Real-time listener for user roles
export function subscribeToUserRoles(
  onData: (roles: AppUserAccount[]) => void,
  onError?: (err: Error) => void
) {
  const path = 'user_roles';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: AppUserAccount[] = [];
      snapshot.forEach(docSnap => {
        list.push(docSnap.data() as AppUserAccount);
      });
      updateCachedUserRoles(list);
      onData(list);
    },
    (error) => {
      console.warn('Real-time user_roles listener note:', error);
      if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

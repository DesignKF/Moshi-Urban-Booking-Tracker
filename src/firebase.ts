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
import { type Reservation } from './types';
import { checkNewBookingConflict } from './bookingConflicts';

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

  // 4. Default for other signed-in users (Staff view-only unless explicitly upgraded by admin)
  return 'staff';
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
      role: role === 'viewer' ? 'staff' : role,
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

export async function saveReservationToFirestore(res: Reservation): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Authentication required: please sign in to save reservations.');
  }
  if (!isAuthorizedPropertyManagerOrAdmin(auth.currentUser.email)) {
    throw new Error('Permission denied: only Property Managers and Administrators can save reservations.');
  }

  // 1. Validation checks
  if (!res.id || !res.guestName || !res.room || !res.bedCode || !res.checkIn || !res.checkOut) {
    throw new Error('Validation error: missing required reservation fields.');
  }
  if (res.checkIn >= res.checkOut) {
    throw new Error(`Invalid date range: check-in (${res.checkIn}) must be before check-out (${res.checkOut}).`);
  }

  // 2. Authoritative Double-Booking Prevention
  // Only check conflicts for inventory-blocking reservations (ignore cancelled)
  const isCancelled = (res.status || '').toLowerCase().includes('cancel');
  if (!isCancelled) {
    const existingList = await fetchReservationsFromFirestore();
    const conflict = checkNewBookingConflict(res, existingList, res.id);
    if (conflict) {
      throw new Error(`Double-booking prevented: ${conflict.description}`);
    }
  }

  const reservationPath = `reservations/${res.id}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser.email || 'system';

  try {
    // Save reservation document
    const docRef = doc(db, 'reservations', res.id);
    await setDoc(docRef, {
      ...res,
      updatedAt: now
    }, { merge: true });

    // Save/update guest record
    const guestId = res.guestId || `GS-${res.id.replace(/\D/g, '').padStart(4, '0')}`;
    const guestDocRef = doc(db, 'guests', guestId);
    await setDoc(guestDocRef, {
      id: guestId,
      name: res.guestName,
      email: res.email || '',
      phone: res.phone || '',
      loyalty: res.loyalty || 'Standard',
      notes: res.notes || '',
      updatedAt: now
    }, { merge: true }).catch(e => console.warn('Guest record note:', e));

    // If deposit/paid amount exists, record payment transaction
    if (res.paidAmount && res.paidAmount > 0) {
      const paymentId = `PAY-${res.id}-${Date.now()}`;
      const payDocRef = doc(db, 'payments', paymentId);
      await setDoc(payDocRef, {
        id: paymentId,
        reservationId: res.id,
        guestId,
        amount: res.paidAmount,
        currency: res.currency || 'USD',
        type: res.balanceDue === 0 ? 'full' : 'deposit',
        recordedBy: userEmail,
        notes: `Recorded with reservation ${res.id}`,
        createdAt: now
      }, { merge: true }).catch(e => console.warn('Payment record note:', e));
    }

    // Log in audit trail
    const auditId = `LOG-${res.id}-${Date.now()}`;
    const auditDocRef = doc(db, 'audit_logs', auditId);
    await setDoc(auditDocRef, {
      id: auditId,
      action: 'save_reservation',
      targetId: res.id,
      guestName: res.guestName,
      user: userEmail,
      timestamp: now,
      diffSummary: `Saved ${res.id} for ${res.guestName} (${res.room} - ${res.bedCode})`
    }).catch(e => console.warn('Audit log note:', e));

  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, reservationPath);
  }
}

export async function deleteReservationFromFirestore(reservationId: string): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Authentication required.');
  }
  if (!isAuthorizedAdminEmail(auth.currentUser.email)) {
    throw new Error('Permission denied: only Administrators can delete reservations.');
  }
  const path = `reservations/${reservationId}`;
  try {
    const docRef = doc(db, 'reservations', reservationId);
    await deleteDoc(docRef);

    // Audit log
    const auditId = `LOG-DEL-${reservationId}-${Date.now()}`;
    await setDoc(doc(db, 'audit_logs', auditId), {
      id: auditId,
      action: 'delete_reservation',
      targetId: reservationId,
      user: auth.currentUser.email || 'admin',
      timestamp: new Date().toISOString(),
      diffSummary: `Deleted reservation ${reservationId}`
    }).catch(() => {});
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
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

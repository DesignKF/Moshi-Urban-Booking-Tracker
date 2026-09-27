import { initializeApp } from 'firebase/app';
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
  orderBy
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { type Reservation } from './types';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

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
  const path = `reservations/${res.id}`;
  try {
    const docRef = doc(db, 'reservations', res.id);
    await setDoc(docRef, {
      ...res,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteReservationFromFirestore(reservationId: string): Promise<void> {
  const path = `reservations/${reservationId}`;
  try {
    const docRef = doc(db, 'reservations', reservationId);
    await deleteDoc(docRef);
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

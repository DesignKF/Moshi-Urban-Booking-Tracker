import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Desired Google Workspace Scopes
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = localStorage.getItem('google_workspace_access_token');

export const clearAccessToken = () => {
  cachedAccessToken = null;
  localStorage.removeItem('google_workspace_access_token');
  localStorage.removeItem('google_workspace_token_timestamp');
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const storedToken = cachedAccessToken || localStorage.getItem('google_workspace_access_token');
      const tokenTimeStr = localStorage.getItem('google_workspace_token_timestamp');
      const tokenTime = tokenTimeStr ? parseInt(tokenTimeStr, 10) : 0;
      
      // If there is no timestamp recorded or the token is older than 50 minutes, it is expired
      const isTokenValid = Boolean(
        storedToken && 
        tokenTime > 0 && 
        (Date.now() - tokenTime < 50 * 60 * 1000)
      );

      if (isTokenValid && storedToken) {
        cachedAccessToken = storedToken;
        if (onAuthSuccess) onAuthSuccess(user, storedToken);
      } else {
        // Token is missing, untracked, or expired
        clearAccessToken();
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      clearAccessToken();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google sign in');
    }
    cachedAccessToken = credential.accessToken;
    localStorage.setItem('google_workspace_access_token', credential.accessToken);
    localStorage.setItem('google_workspace_token_timestamp', String(Date.now()));
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  const tokenTimeStr = localStorage.getItem('google_workspace_token_timestamp');
  const tokenTime = tokenTimeStr ? parseInt(tokenTimeStr, 10) : 0;
  // If no timestamp or older than 50 min, token is considered expired
  if (!tokenTime || Date.now() - tokenTime > 50 * 60 * 1000) {
    clearAccessToken();
    return null;
  }
  if (!cachedAccessToken) {
    cachedAccessToken = localStorage.getItem('google_workspace_access_token');
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  clearAccessToken();
};

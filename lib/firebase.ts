import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, User } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCuy0fB2_KqlKuntBy_8yqSSs2TKPjil5Y',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'production-scheduler-em-ops.firebaseapp.com',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'production-scheduler-em-ops',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'production-scheduler-em-ops.firebasestorage.app',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '100892787122',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:100892787122:web:2795907490b5c625c9e4ab'
};

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let ensureAuthPromise: Promise<User> | null = null;

export async function ensureFirebaseSession(): Promise<User> {
    if (typeof window === 'undefined') {
        throw new Error('ensureFirebaseSession must be called in the browser.');
    }

    if (auth.currentUser) {
        return auth.currentUser;
    }

    if (!ensureAuthPromise) {
        ensureAuthPromise = signInAnonymously(auth)
            .then((credential) => credential.user)
            .catch((error) => {
                ensureAuthPromise = null;
                throw error;
            });
    }

    return ensureAuthPromise;
}

export { app, db, auth };

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyCuy0fB2_KqlKuntBy_8yqSSs2TKPjil5Y",
    authDomain: "production-scheduler-em-ops.firebaseapp.com",
    projectId: "production-scheduler-em-ops",
    storageBucket: "production-scheduler-em-ops.firebasestorage.app",
    messagingSenderId: "100892787122",
    appId: "1:100892787122:web:2795907490b5c625c9e4ab"
};

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };

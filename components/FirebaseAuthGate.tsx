'use client';

import { ReactNode, useEffect, useState } from 'react';
import { ensureFirebaseSession } from '@/lib/firebase';

interface FirebaseAuthGateProps {
    children: ReactNode;
}

export default function FirebaseAuthGate({ children }: FirebaseAuthGateProps) {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        ensureFirebaseSession()
            .then(() => {
                if (!active) return;
                setReady(true);
            })
            .catch((err) => {
                console.error('Firebase auth bootstrap failed:', err);
                if (!active) return;
                setError('Unable to connect to Firebase Auth. Enable Anonymous sign-in for this project.');
            });

        return () => {
            active = false;
        };
    }, []);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-6">
                <div className="max-w-lg rounded-xl border border-rose-500/50 bg-rose-950/30 p-6 text-sm">
                    <p className="font-semibold text-rose-200">Authentication setup required</p>
                    <p className="mt-2 text-rose-100/90">{error}</p>
                </div>
            </div>
        );
    }

    if (!ready) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 text-sm">
                Connecting to Firebase...
            </div>
        );
    }

    return <>{children}</>;
}

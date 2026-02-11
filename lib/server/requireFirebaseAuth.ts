import { NextRequest, NextResponse } from 'next/server';

interface LookupUser {
    localId: string;
    email?: string;
}

interface LookupResponse {
    users?: LookupUser[];
}

interface AuthenticatedResult {
    ok: true;
    user: LookupUser;
}

interface UnauthorizedResult {
    ok: false;
    response: NextResponse<{ error: string }>;
}

type RequireAuthResult = AuthenticatedResult | UnauthorizedResult;

const FALLBACK_FIREBASE_API_KEY = 'AIzaSyCuy0fB2_KqlKuntBy_8yqSSs2TKPjil5Y';

async function verifyToken(idToken: string): Promise<LookupUser | null> {
    const apiKey =
        process.env.FIREBASE_WEB_API_KEY ||
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
        FALLBACK_FIREBASE_API_KEY;

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        }
    );

    if (!response.ok) {
        return null;
    }

    const payload = (await response.json()) as LookupResponse;
    const user = payload.users?.[0];
    if (!user?.localId) {
        return null;
    }

    return user;
}

export async function requireFirebaseAuth(request: NextRequest): Promise<RequireAuthResult> {
    const authorization = request.headers.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        };
    }

    const idToken = authorization.slice('Bearer '.length).trim();
    if (!idToken) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        };
    }

    try {
        const user = await verifyToken(idToken);
        if (!user) {
            return {
                ok: false,
                response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            };
        }

        return { ok: true, user };
    } catch (error) {
        console.error('Firebase auth verification failed:', error);
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        };
    }
}

import { ensureFirebaseSession } from '@/lib/firebase';

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const user = await ensureFirebaseSession();
    const token = await user.getIdToken();

    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(input, {
        ...init,
        headers
    });
}

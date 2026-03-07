import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "mock-api-key",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mock-auth",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mock-project",
};

// Initialize Firebase only if we have a real or mock config
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Module-level singleton: if a sign-in is already in-flight, both callers
// await the same promise instead of each firing signInAnonymously() independently.
// This prevents React StrictMode's double-invocation from creating two Firebase users.
let _signInPromise: Promise<void> | null = null;

export const signIn = async () => {
    // Already signed in — nothing to do
    if (auth.currentUser) return auth.currentUser;

    // Sign-in already in progress — join it instead of starting a new one
    if (!_signInPromise) {
        _signInPromise = signInAnonymously(auth)
            .then(() => { })
            .catch((e) => {
                console.error('Firebase auth failed', e);
                throw e;
            })
            .finally(() => {
                _signInPromise = null;
            });
    }

    await _signInPromise;
    return auth.currentUser;
};


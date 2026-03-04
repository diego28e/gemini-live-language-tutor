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

export const signIn = async () => {
    try {
        const userCredential = await signInAnonymously(auth);
        return userCredential.user;
    } catch (e) {
        console.error("Firebase auth failed", e);
        throw e;
    }
};

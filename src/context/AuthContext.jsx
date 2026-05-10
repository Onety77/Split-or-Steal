import { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);  // Firebase auth user
  const [profile, setProfile] = useState(null);  // Firestore user profile
  const [loading, setLoading] = useState(true);

  // Listen for auth state changes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        // Load profile from Firestore
        const snap = await getDoc(doc(db, "sos_users", fbUser.uid));
        if (snap.exists()) setProfile(snap.data());
        else setProfile(null);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Sign up
  const signUp = async ({ username, email, password, wallet }) => {
    // Check username is not taken
    const taken = await getDoc(doc(db, "sos_usernames", username.toLowerCase()));
    if (taken.exists()) throw new Error("Username already taken");

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    const profileData = {
      uid,
      username,
      email,
      wallet,
      joinedAt:  serverTimestamp(),
      wins:      0,
      losses:    0,
      splits:    0,
      steals:    0,
      totalEarned: 0,
    };

    // Save profile and claim username atomically
    await setDoc(doc(db, "sos_users", uid), profileData);
    await setDoc(doc(db, "sos_usernames", username.toLowerCase()), { uid });

    setProfile(profileData);
    return cred.user;
  };

  // Sign in
  const signIn = async ({ email, password }) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const snap = await getDoc(doc(db, "sos_users", cred.user.uid));
    if (snap.exists()) setProfile(snap.data());
    return cred.user;
  };

  // Sign out
  const signOut = async () => {
    await fbSignOut(auth);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

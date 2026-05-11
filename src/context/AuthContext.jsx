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
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
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

  const signUp = async ({ username, email, password, wallet }) => {
    // 1. Check username not taken
    const usernameTaken = await getDoc(doc(db, "sos_usernames", username.toLowerCase()));
    if (usernameTaken.exists()) throw new Error("Username already taken");

    // 2. Check wallet not already registered to another account
    const walletTaken = await getDoc(doc(db, "sos_wallets", wallet.toLowerCase()));
    if (walletTaken.exists()) throw new Error("This wallet is already registered to another account. Each wallet can only have one account.");

    // 3. Create Firebase auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    const profileData = {
      uid,
      username,
      email,
      wallet,
      joinedAt:    serverTimestamp(),
      wins:        0,
      losses:      0,
      splits:      0,
      steals:      0,
      totalEarned: 0,
    };

    // 4. Save profile, claim username, claim wallet — all three
    await Promise.all([
      setDoc(doc(db, "sos_users",     uid),                  profileData),
      setDoc(doc(db, "sos_usernames", username.toLowerCase()), { uid }),
      setDoc(doc(db, "sos_wallets",   wallet.toLowerCase()),   { uid }),
    ]);

    setProfile(profileData);
    return cred.user;
  };

  const signIn = async ({ email, password }) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const snap = await getDoc(doc(db, "sos_users", cred.user.uid));
    if (snap.exists()) setProfile(snap.data());
    return cred.user;
  };

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
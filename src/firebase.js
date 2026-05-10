import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyAnJblPmZQmSvhq2cFN2mqbU17YPJ5y_Lk",
  authDomain:        "split-or-steal-fd95f.firebaseapp.com",
  projectId:         "split-or-steal-fd95f",
  storageBucket:     "split-or-steal-fd95f.firebasestorage.app",
  messagingSenderId: "161955798477",
  appId:             "1:161955798477:web:936385daf65cd51314f884",
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
export default app;

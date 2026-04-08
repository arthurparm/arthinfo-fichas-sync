import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export class FirebaseClient {
  constructor(config) {
    this.app = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
    this.googleProvider = new GoogleAuthProvider();
    this.googleProvider.setCustomParameters({ prompt: 'select_account' });
  }

  async login(email, password) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  async loginWithGoogle() {
    return signInWithPopup(this.auth, this.googleProvider);
  }

  async loginWithGoogleRedirect() {
    return signInWithRedirect(this.auth, this.googleProvider);
  }

  async loginWithGooglePopupOrRedirect() {
    try {
      await this.loginWithGoogle();
      return 'popup';
    } catch (err) {
      if (err?.code === 'auth/popup-blocked') {
        await this.loginWithGoogleRedirect();
        return 'redirect';
      }

      throw err;
    }
  }
}

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
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

  async waitForAuthReady({ requireUser = false, timeoutMs = 10000 } = {}) {
    if (typeof this.auth.authStateReady === 'function') {
      await this.auth.authStateReady();
    } else {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('Tempo esgotado aguardando a autenticação do Firebase.'));
        }, timeoutMs);

        const unsubscribe = onAuthStateChanged(
          this.auth,
          () => {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          },
          (error) => {
            clearTimeout(timeout);
            unsubscribe();
            reject(error);
          }
        );
      });
    }

    if (this.auth.currentUser) {
      await this.auth.currentUser.getIdToken();
    }

    if (requireUser && !this.auth.currentUser) {
      throw new Error('Usuário não autenticado no Firebase.');
    }

    return this.auth.currentUser;
  }

  async login(email, password) {
    const credentials = await signInWithEmailAndPassword(this.auth, email, password);
    await this.waitForAuthReady({ requireUser: true });
    return credentials;
  }

  async loginWithGoogle() {
    const credentials = await signInWithPopup(this.auth, this.googleProvider);
    await this.waitForAuthReady({ requireUser: true });
    return credentials;
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

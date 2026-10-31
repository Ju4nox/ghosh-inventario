import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'ghosh_auth_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<string | null>(this.readStoredUser());

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  login(username: string, password: string): boolean {
    const cleanUser = username.trim();
    if (cleanUser === 'admin' && password === 'admin') {
      try {
        sessionStorage.setItem(STORAGE_KEY, cleanUser);
      } catch {
        // Ignorar si sessionStorage no está disponible
      }
      this.currentUser.set(cleanUser);
      return true;
    }
    return false;
  }

  logout(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignorar
    }
    this.currentUser.set(null);
  }

  private readStoredUser(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}

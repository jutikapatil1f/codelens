"use client";

// Holds the logged-in user's JWT and persists it to localStorage so a refresh
// doesn't log you out. Any component can read/update it via useAuth().

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "codelens_token";

interface AuthContextValue {
  token: string | null;
  ready: boolean; // false until we've read localStorage (avoids SSR flicker)
  setToken: (token: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // localStorage is only available in the browser, so read it after mount.
  useEffect(() => {
    setTokenState(localStorage.getItem(STORAGE_KEY));
    setReady(true);
  }, []);

  const setToken = (next: string | null) => {
    setTokenState(next);
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  };

  const logout = () => setToken(null);

  return (
    <AuthContext.Provider value={{ token, ready, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

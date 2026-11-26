"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SessionManager } from "@/lib/auth/session";
import { useWallet } from "./WalletProvider";
import { backupEditorBuffers } from "@/lib/auth/editorBackup";
import SessionTimeoutModal from "../SessionTimeoutModal";

const AuthContext = createContext<ReturnType<typeof useSession> | null>(null);

function useSession() {
  const wallet = useWallet();
  const [manager] = useState(
    () =>
      new SessionManager(
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000",
        {
          serverAccount: process.env.NEXT_PUBLIC_SEP10_SERVER_ACCOUNT || "",
          homeDomain: process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN || "localhost",
          webAuthDomain:
            process.env.NEXT_PUBLIC_SEP10_WEB_AUTH_DOMAIN ||
            process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN ||
            "localhost",
          networkPassphrase:
            process.env.NEXT_PUBLIC_SEP10_NETWORK_PASSPHRASE ||
            "Test SDF Network ; November 2015",
        },
      ),
  );
  const session = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getServerSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const identity = `${wallet.address || ""}:${wallet.network || ""}`;
  const previousIdentity = useRef(identity);
  const accountMismatch =
    !!session.user && !!wallet.address && session.user.id !== wallet.address;
  const validSession = !accountMismatch;
  useEffect(() => {
    void manager.refresh().catch(() => {});
  }, [manager]);
  useLayoutEffect(() => {
    if (accountMismatch) {
      void manager
        .logout()
        .catch(() => setError("Session logout failed; please retry"));
    } else if (previousIdentity.current !== identity) {
      const previous = previousIdentity.current;
      previousIdentity.current = identity;
      if (
        previous !== ":" ||
        (session.user && session.user.id !== wallet.address)
      ) {
        void manager
          .logout()
          .catch(() => setError("Session logout failed; please retry"));
      }
    }
  }, [identity, manager, session.user, wallet.address, accountMismatch]);

  // Monitor JWT expiration, trigger backup, and display warning modal 2 minutes before timeout
  useEffect(() => {
    if (!session.token || !session.expiresAt) {
      setShowTimeoutModal(false);
      return;
    }

    const checkInterval = setInterval(() => {
      const remainingMs = session.expiresAt - Date.now();
      const remainingSecs = Math.max(0, Math.ceil(remainingMs / 1000));

      // 2 minutes (120s) warning threshold
      if (remainingSecs <= 120 && remainingSecs > 0) {
        if (!showTimeoutModal) {
          backupEditorBuffers();
          setShowTimeoutModal(true);
        }
        setTimeoutSeconds(remainingSecs);
      } else if (remainingSecs <= 0) {
        backupEditorBuffers();
        setShowTimeoutModal(false);
        void manager
          .logout()
          .catch(() => setError("Session expired. Sign in again."));
      } else {
        setShowTimeoutModal(false);
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [manager, session.token, session.expiresAt, showTimeoutModal]);

  const extendSession = useCallback(async () => {
    setIsRefreshingSession(true);
    try {
      await manager.refresh();
      setShowTimeoutModal(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session renewal failed");
      throw err;
    } finally {
      setIsRefreshingSession(false);
    }
  }, [manager]);

  const getAuthToken = useCallback(
    async () => (validSession ? manager.getAuthToken() : null),
    [manager, validSession],
  );
  return {
    ...session,
    token: validSession ? session.token : null,
    user: validSession ? session.user : null,
    isAuthenticated: validSession && !!session.token,
    isLoading,
    error,
    showTimeoutModal,
    timeoutSeconds,
    isRefreshingSession,
    extendSession,
    getAuthToken,
    login: async () => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet.address || wallet.status !== "connected")
          throw new Error("Connect a wallet first");
        await manager.login(wallet.address, wallet.signTransaction);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Sign in failed");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    logout: async () => {
      setError(null);
      try {
        backupEditorBuffers();
        await manager.logout();
      } catch (error) {
        setError("Session logout failed; please retry");
        throw error;
      }
    },
  };
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useSession();
  return (
    <AuthContext.Provider value={auth}>
      {children}
      <SessionTimeoutModal
        isOpen={auth.showTimeoutModal}
        secondsRemaining={auth.timeoutSeconds}
        isRefreshing={auth.isRefreshingSession}
        onExtend={auth.extendSession}
        onLogout={auth.logout}
      />
    </AuthContext.Provider>
  );
}
export function useAuthContext() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within an AuthProvider");
  return auth;
}

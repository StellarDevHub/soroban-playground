/**
 * Wallet Hook - Manages wallet connection state
 */

import { useState, useEffect, useCallback } from 'react';

interface WalletState {
  publicKey: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    publicKey: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  // Check for existing connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      // Check if Freighter or other wallet is available
      if (typeof window !== 'undefined' && (window as any).freighter) {
        const publicKey = await (window as any).freighter.getPublicKey();
        if (publicKey) {
          setState({
            publicKey,
            isConnected: true,
            isConnecting: false,
            error: null,
          });
        }
      }
    } catch {
      // Wallet not connected or not available
    }
  };

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      if (typeof window === 'undefined') {
        throw new Error('Window not available');
      }

      const freighter = (window as any).freighter;
      if (!freighter) {
        throw new Error('Freighter wallet not installed. Please install it from https://www.freighter.app/');
      }

      const publicKey = await freighter.getPublicKey();
      
      setState({
        publicKey,
        isConnected: true,
        isConnecting: false,
        error: null,
      });

      return publicKey;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect wallet';
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      publicKey: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    connect,
    disconnect,
  };
}

export default useWallet;

"use client";

import { useWallet as useWalletContext, WalletContextType } from "../components/providers/WalletProvider";
import { WalletStatus, WalletState } from "./useFreighterWallet";

export { useWalletContext as useWallet };
export type { WalletContextType, WalletStatus, WalletState };
export default useWalletContext;

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Deployed-contract registry (issue #1527).
 *
 * The command palette has to answer "where is that contract I deployed?", which
 * means it needs a list of contract ids from *this* browser — the chain is not
 * queried on every keystroke. Deployments are recorded here as they happen and
 * mirrored into the workspace snapshot so they follow the user to another
 * device (#1526).
 *
 * Backed by `localStorage` with the same conventions as `hooks/useFavorites`.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson, writeJson } from "@/lib/offline/storage";

export const DEPLOYED_CONTRACTS_STORAGE_KEY = "sp:deployed-contracts";
export const DEPLOYED_CONTRACTS_CAPACITY = 50;

/**
 * Strkey check for a *contract* id.
 *
 * Soroban contract ids are 56-character strkeys starting with `C` (the final
 * four characters are the CRC16 checksum), distinct from `G…` account
 * addresses and `S…` muxed seeds. Validating the prefix matters here because
 * the palette indexes this list next to wallet addresses.
 */
const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

export interface DeployedContract {
  /** Contract id (`C…`). */
  contractId: string;
  /** Template it was deployed from, when known. */
  templateId?: string;
  /** Human label; defaults to a truncated contract id. */
  label: string;
  /** Stellar network passphrase. */
  network: string;
  /** Epoch ms of the deployment. */
  deployedAt: number;
  /** Deploying transaction hash, when known. */
  txHash?: string;
}

function isDeployedContract(value: unknown): value is DeployedContract {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<DeployedContract>;
  return (
    typeof entry.contractId === "string" &&
    CONTRACT_ID_RE.test(entry.contractId) &&
    typeof entry.deployedAt === "number"
  );
}

export function isStellarContractId(value: string): boolean {
  return CONTRACT_ID_RE.test(value);
}

/** `CABC…WXYZ` — the form Stellar itself uses in explorers. */
export function shortenContractId(contractId: string): string {
  if (contractId.length <= 12) return contractId;
  return `${contractId.slice(0, 6)}…${contractId.slice(-4)}`;
}

export function loadDeployedContracts(): DeployedContract[] {
  const raw = readJson<unknown>(DEPLOYED_CONTRACTS_STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDeployedContract).slice(0, DEPLOYED_CONTRACTS_CAPACITY);
}

export function saveDeployedContracts(
  entries: DeployedContract[],
): DeployedContract[] {
  const trimmed = entries.slice(0, DEPLOYED_CONTRACTS_CAPACITY);
  writeJson(DEPLOYED_CONTRACTS_STORAGE_KEY, trimmed);
  return trimmed;
}

export function recordDeployment(
  entries: readonly DeployedContract[],
  contract: DeployedContract,
): DeployedContract[] {
  const withoutDuplicate = entries.filter(
    (item) => item.contractId !== contract.contractId,
  );
  return saveDeployedContracts([contract, ...withoutDuplicate]);
}

export interface UseDeployedContracts {
  contracts: DeployedContract[];
  record: (contract: DeployedContract) => void;
  remove: (contractId: string) => void;
  clear: () => void;
}

export function useDeployedContracts(): UseDeployedContracts {
  const [contracts, setContracts] = useState<DeployedContract[]>([]);

  useEffect(() => {
    setContracts(loadDeployedContracts());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEPLOYED_CONTRACTS_STORAGE_KEY) return;
      setContracts(loadDeployedContracts());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const record = useCallback((contract: DeployedContract) => {
    setContracts((previous) => recordDeployment(previous, contract));
  }, []);

  const remove = useCallback((contractId: string) => {
    setContracts((previous) =>
      saveDeployedContracts(
        previous.filter((item) => item.contractId !== contractId),
      ),
    );
  }, []);

  const clear = useCallback(() => {
    setContracts(saveDeployedContracts([]));
  }, []);

  return { contracts, record, remove, clear };
}

export default useDeployedContracts;

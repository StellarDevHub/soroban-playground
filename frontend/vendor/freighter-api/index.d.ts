export type FreighterErrorResult = {
  error?: string;
};

export declare function isConnected(): Promise<
  { isConnected: boolean } & FreighterErrorResult
>;

export declare function isAllowed(): Promise<
  { isAllowed: boolean } & FreighterErrorResult
>;

export declare function getAddress(): Promise<
  { address: string } & FreighterErrorResult
>;

export declare function requestAccess(): Promise<
  { address: string } & FreighterErrorResult
>;

export declare function getNetworkDetails(): Promise<
  {
    network: string;
    networkPassphrase: string;
    networkUrl?: string;
    sorobanRpcUrl?: string;
  } & FreighterErrorResult
>;

declare const _default: {
  isConnected: typeof isConnected;
  isAllowed: typeof isAllowed;
  getAddress: typeof getAddress;
  requestAccess: typeof requestAccess;
  getNetworkDetails: typeof getNetworkDetails;
};

export default _default;

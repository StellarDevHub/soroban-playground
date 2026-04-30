function getFreighterApi() {
  if (typeof window !== "undefined" && window.freighterApi) {
    return window.freighterApi;
  }

  return null;
}

function disconnectedResult(message) {
  return { error: message };
}

export async function isConnected() {
  const api = getFreighterApi();

  if (!api || typeof api.isConnected !== "function") {
    return {
      isConnected: false,
      ...disconnectedResult("Freighter extension not detected in this browser."),
    };
  }

  return api.isConnected();
}

export async function isAllowed() {
  const api = getFreighterApi();

  if (!api || typeof api.isAllowed !== "function") {
    return {
      isAllowed: false,
      ...disconnectedResult("Freighter extension not detected in this browser."),
    };
  }

  return api.isAllowed();
}

export async function getAddress() {
  const api = getFreighterApi();

  if (!api || typeof api.getAddress !== "function") {
    return {
      address: "",
      ...disconnectedResult("Freighter extension not detected in this browser."),
    };
  }

  return api.getAddress();
}

export async function requestAccess() {
  const api = getFreighterApi();

  if (!api || typeof api.requestAccess !== "function") {
    return {
      address: "",
      ...disconnectedResult("Freighter extension not detected in this browser."),
    };
  }

  return api.requestAccess();
}

export async function getNetworkDetails() {
  const api = getFreighterApi();

  if (!api || typeof api.getNetworkDetails !== "function") {
    return {
      network: "TESTNET",
      networkPassphrase: "",
      networkUrl: "",
      sorobanRpcUrl: "",
      ...disconnectedResult("Freighter extension not detected in this browser."),
    };
  }

  return api.getNetworkDetails();
}

export default {
  isConnected,
  isAllowed,
  getAddress,
  requestAccess,
  getNetworkDetails,
};

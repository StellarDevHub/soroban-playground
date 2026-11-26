import {
  computeDagreLikeLayout,
  isLayoutResponse,
  type LayoutRequest,
} from "../utils/transactionGraphLayout";

// Cast to Worker so the file type-checks with the app's DOM lib configuration.
const workerScope = self as unknown as Worker;

workerScope.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { requestId, nodes, edges } = event.data;
  const message = {
    requestId,
    positions: computeDagreLikeLayout(nodes, edges),
  };

  if (isLayoutResponse(message)) {
    workerScope.postMessage(message);
  }
};

export {};

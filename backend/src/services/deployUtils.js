export function normalizeBatchContract(contract, index, defaultNetwork) {
  const wasmPath = contract?.wasmPath;
  const contractName = contract?.contractName || contract?.name;

  if (!wasmPath || typeof wasmPath !== 'string') {
    throw new Error(`contracts[${index}].wasmPath is required`);
  }
  if (!contractName || typeof contractName !== 'string') {
    throw new Error(`contracts[${index}].contractName is required`);
  }

  return {
    id: contract.id || `${contractName}-${index + 1}`,
    contractName,
    wasmPath,
    dependencies: Array.isArray(contract.dependencies)
      ? contract.dependencies.filter((dep) => typeof dep === 'string')
      : [],
    sourceAccount:
      typeof contract.sourceAccount === 'string'
        ? contract.sourceAccount
        : process.env.SOROBAN_SOURCE_ACCOUNT,
    network:
      contract.network ||
      defaultNetwork ||
      process.env.DEFAULT_NETWORK ||
      'testnet',
  };
}

export function validateBatchContractsInput(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new Error('contracts must be a non-empty array');
  }
  return contracts;
}

export function topoSortContracts(contracts) {
  const graph = new Map(contracts.map((contract) => [contract.id, contract]));
  const inDegree = new Map(contracts.map((contract) => [contract.id, 0]));
  const edges = new Map(contracts.map((contract) => [contract.id, []]));

  for (const contract of contracts) {
    for (const dep of contract.dependencies) {
      if (!graph.has(dep)) {
        throw new Error(`Missing dependency "${dep}" for ${contract.id}`);
      }
      edges.get(dep).push(contract.id);
      inDegree.set(contract.id, inDegree.get(contract.id) + 1);
    }
  }

  const queue = contracts
    .filter((contract) => inDegree.get(contract.id) === 0)
    .map((contract) => contract.id);
  const ordered = [];

  while (queue.length > 0) {
    const id = queue.shift();
    ordered.push(graph.get(id));
    for (const nextId of edges.get(id)) {
      inDegree.set(nextId, inDegree.get(nextId) - 1);
      if (inDegree.get(nextId) === 0) {
        queue.push(nextId);
      }
    }
  }

  if (ordered.length !== contracts.length) {
    throw new Error('Circular dependency detected in batch deployment');
  }

  return ordered;
}

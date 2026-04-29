# Troubleshooting

## Common Issues

### Contract returns `ContractPaused` on upload

**Cause**: The admin has paused the contract for maintenance.
**Solution**: Wait for admin to unpause or call `unpause_contract` if you are the admin.

### `Unauthorized` when uploading a file

**Cause**: The `owner` address did not sign the transaction (wrong `x-source-account` header).
**Solution**: Ensure the caller's secret key is set in `SOROBAN_SOURCE_ACCOUNT` and that the `owner` field matches the authenticated invoker.

### `InsufficientNodeCapacity` during upload

**Cause**: Not enough registered storage nodes have free capacity to satisfy the requested redundancy factor.
**Solution**: Register more nodes with larger capacity, or lower the redundancy factor.

### `FileNotFound` when retrieving a file

**Cause**: The `file_id` is incorrect or the file was deleted.
**Solution**: Verify the SHA-256 hash used as file_id matches the original. Use the dashboard to see available files.

### Backend returns 502 Bad Gateway

**Cause**: Soroban CLI invocation failed (e.g., contract error, network issue).
**Details**: Check backend logs for stderr output from CLI.
**Solution**: Verify `SOROBAN_SOURCE_ACCOUNT` balance, network status, and that the contract is deployed to the specified network.

### WebSocket connection fails to connect to `/ws/cloud-storage-events`

**Cause**: The backend has not been extended to broadcast cloud storage events on that subpath.
**Note**: This is a known limitation; real-time updates require additional WS integration (out of current scope).

## Debugging Tips

- Use the contract's `get_file` and `get_shard` functions directly via CLI to inspect state.
- Check event logs in the Soroban network explorer for the contract.
- Monitor backend logs for rate limiting or Redis errors.
- In the frontend, use browser dev tools to inspect network requests and confirm headers.

## Getting Help

- Open an issue on the project repository.
- Consult the Soroban documentation: https://developers.stellar.org/docs/build/smart-contracts

# Beginner Issue Drafts

These issue drafts are intentionally small and beginner-friendly.

## Merge-Safe Maintainer Rule

To reduce merge conflicts, each issue below has a strict ownership boundary:

- one contributor per issue
- one primary file per issue
- contributors should not expand scope outside the listed file unless a maintainer asks

This makes it much easier to review and merge issues in any order.

## Contributor ETA Policy

Add this note to every issue:

> Contributor note: Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

## Beginner Issues

### 1. [Backend] Improve the Health Check Response

**Why this is a good beginner issue**
The backend already has a working health route, so this task is about improving an existing endpoint without changing the rest of the app.

**Primary file**
- `backend/src/server.js`

**Scope**
- Update `/api/health` to return a richer JSON response
- Add fields such as `status`, `message`, `timestamp`, and `service`
- Keep the response simple and consistent

**Acceptance criteria**
- `GET /api/health` still works
- Response includes at least one new metadata field
- No other routes are changed

**Merge-safety note**
Please keep changes limited to `backend/src/server.js`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

## Recommended Merge Order

Because each issue is isolated to a different file, you should be able to merge them whenever you want.

If you still want a comfortable order, use this:

1. `[Backend] Improve the Health Check Response`

## Medium Issues

These medium issues are also designed to avoid merge conflicts by assigning each task to a different primary file.

### 1. [Backend] Return Structured Compile Metadata and Better Error Details

**Why this is a medium issue**
The compile route already works, but the response is minimal. Improving it requires touching build output handling, validation, and error formatting.

**Primary file**
- `backend/src/routes/compile.js`

**Scope**
- Return richer compile metadata such as build status, logs, and artifact information
- Improve compilation failure responses so the frontend gets clearer feedback
- Keep the current compile flow intact

**Acceptance criteria**
- Successful compile responses include more than `success` and `message`
- Failed compile responses are easier to debug
- Changes stay limited to `backend/src/routes/compile.js`

**Merge-safety note**
Please keep changes limited to `backend/src/routes/compile.js`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

## Contract Issues

These contract issues are designed to be merge-safe by assigning each one to a separate new directory or dedicated contract docs file.

### 1. [Contract] Add a `contracts/README.md` for Contract Examples and Local Usage

**Why this is a good contract issue**
The repository does not yet have a contract examples area, so this issue creates the documentation foundation contributors can build on.

**Primary file**
- `contracts/README.md`

**Scope**
- Add a new `contracts/README.md`
- Explain the purpose of the contract examples folder
- Document how contributors should organize future contract example directories
- Keep the guide simple and beginner-friendly

**Acceptance criteria**
- `contracts/README.md` exists
- The file explains the purpose and structure of the contract examples area
- The instructions are clear enough for a first-time contributor

**Merge-safety note**
Please keep changes limited to `contracts/README.md`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 2. [Contract] Add a Hello World Soroban Contract Example

**Why this is a medium issue**
This creates the first actual example contract and gives the project a simple reference implementation that matches the playground theme.

**Primary file group**
- `contracts/hello-world/`

**Scope**
- Add a new `contracts/hello-world/` example contract
- Include the minimal files needed for a Soroban example such as `Cargo.toml` and `src/lib.rs`
- Keep the contract logic very simple and easy to read

**Acceptance criteria**
- `contracts/hello-world/` exists with a valid example structure
- The contract code is small and beginner-friendly
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/hello-world/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 3. [Contract] Add a Counter Soroban Contract Example

**Why this is a medium issue**
A counter example is a common smart contract learning pattern and gives contributors a more practical contract than hello world.

**Primary file group**
- `contracts/counter/`

**Scope**
- Add a new `contracts/counter/` example contract
- Implement a simple counter contract with small, readable functions
- Keep the example focused on clarity over complexity

**Acceptance criteria**
- `contracts/counter/` exists with a valid example structure
- The contract demonstrates a simple state-changing pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/counter/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 4. [Contract] Add an Admin Setter Soroban Contract Example

**Why this is a medium issue**
This introduces a basic permission-style pattern and gives the project a second realistic contract example without overlapping the counter work.

**Primary file group**
- `contracts/admin-setter/`

**Scope**
- Add a new `contracts/admin-setter/` example contract
- Include a simple admin-controlled setter pattern
- Keep function names and storage usage easy to understand

**Acceptance criteria**
- `contracts/admin-setter/` exists with a valid example structure
- The contract demonstrates a basic access-controlled update flow
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/admin-setter/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 5. [Contract] Add a Key-Value Storage Soroban Contract Example

**Why this is a medium issue**
This adds a useful storage-focused example that can later help with playground demos and backend invocation testing.

**Primary file group**
- `contracts/key-value-store/`

**Scope**
- Add a new `contracts/key-value-store/` example contract
- Implement a simple key-value read and write pattern
- Keep the example small and educational

**Acceptance criteria**
- `contracts/key-value-store/` exists with a valid example structure
- The contract demonstrates a simple storage pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/key-value-store/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 6. [Contract] Add a Voting Soroban Contract Example

**Why this is a medium issue**
This adds a simple voting-style pattern that is useful for demonstrating contract state updates and result queries.

**Primary file group**
- `contracts/voting/`

**Scope**
- Add a new `contracts/voting/` example contract
- Implement a small voting flow with readable functions
- Keep the example educational and compact

**Acceptance criteria**
- `contracts/voting/` exists with a valid example structure
- The contract demonstrates a clear vote/update/read pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/voting/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 7. [Contract] Add a Simple Allowlist Soroban Contract Example

**Why this is a medium issue**
This gives the project a lightweight permission-list example without overlapping the admin setter contract.

**Primary file group**
- `contracts/allowlist/`

**Scope**
- Add a new `contracts/allowlist/` example contract
- Implement a basic allowlist add/check pattern
- Keep the storage layout and functions simple

**Acceptance criteria**
- `contracts/allowlist/` exists with a valid example structure
- The contract demonstrates a simple allowlist pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/allowlist/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 8. [Contract] Add a Donation Tracker Soroban Contract Example

**Why this is a medium issue**
This adds a beginner-friendly financial tracking pattern that can be useful for later playground demos.

**Primary file group**
- `contracts/donation-tracker/`

**Scope**
- Add a new `contracts/donation-tracker/` example contract
- Track simple donation totals or donor contributions
- Keep the logic compact and easy to follow

**Acceptance criteria**
- `contracts/donation-tracker/` exists with a valid example structure
- The contract demonstrates a simple donation-tracking pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/donation-tracker/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 9. [Contract] Add a Profile Registry Soroban Contract Example

**Why this is a medium issue**
This creates a simple record-management example that is easy for contributors to understand and extend.

**Primary file group**
- `contracts/profile-registry/`

**Scope**
- Add a new `contracts/profile-registry/` example contract
- Implement simple set/get profile-style storage behavior
- Keep the data model minimal and readable

**Acceptance criteria**
- `contracts/profile-registry/` exists with a valid example structure
- The contract demonstrates a simple registry pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/profile-registry/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 10. [Contract] Add a Pause Toggle Soroban Contract Example

**Why this is a medium issue**
This introduces a small but useful operational pattern that shows how contract state can enable or block actions.

**Primary file group**
- `contracts/pause-toggle/`

**Scope**
- Add a new `contracts/pause-toggle/` example contract
- Implement a simple paused/unpaused state with readable functions
- Keep the logic focused and easy to review

**Acceptance criteria**
- `contracts/pause-toggle/` exists with a valid example structure
- The contract demonstrates a simple toggle/state-guard pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/pause-toggle/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 11. [Contract] Add a Message Board Soroban Contract Example

**Why this is a medium issue**
This gives the project a straightforward text-storage example that is useful for testing write and read flows.

**Primary file group**
- `contracts/message-board/`

**Scope**
- Add a new `contracts/message-board/` example contract
- Implement a simple post/read message pattern
- Keep the contract small and easy to understand

**Acceptance criteria**
- `contracts/message-board/` exists with a valid example structure
- The contract demonstrates a simple message storage pattern
- The example is documented briefly inside the folder or README

**Merge-safety note**
Please keep changes limited to `contracts/message-board/`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 2. [Backend] Add Request Validation and Clear Error Messages to the Deploy Route

**Why this is a medium issue**
The deploy route is still mocked, but it can already be improved with stronger request validation and more realistic API behavior without building full deployment yet.

**Primary file**
- `backend/src/routes/deploy.js`

**Scope**
- Validate the expected deploy request payload
- Return clear `400` errors when required input is missing
- Make the simulated success response more consistent and descriptive

**Acceptance criteria**
- Invalid deploy requests return a clear validation error
- Success responses remain stable and well-structured
- Changes stay limited to `backend/src/routes/deploy.js`

**Merge-safety note**
Please keep changes limited to `backend/src/routes/deploy.js`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

### 3. [Backend] Normalize Invoke Arguments and Response Shape

**Why this is a medium issue**
The invoke route accepts basic input today, but the API shape is still loose. Tightening it up is a good medium task that improves reliability.

**Primary file**
- `backend/src/routes/invoke.js`

**Scope**
- Normalize `args` handling so non-object input is handled safely
- Improve validation for `contractId`, `functionName`, and `args`
- Return a more consistent response shape for success and error cases

**Acceptance criteria**
- Invalid invoke payloads return useful `400` errors
- Success responses have a predictable structure
- Changes stay limited to `backend/src/routes/invoke.js`

**Merge-safety note**
Please keep changes limited to `backend/src/routes/invoke.js`.

**Contributor note**
Please comment with your ETA before starting work. ETA must not be more than 2 days. If no ETA is added, or if the ETA exceeds 2 days, the issue may be unassigned.

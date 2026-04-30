// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @openapi
 * components:
 *   schemas:
 *     QVProposal:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Proposal ID (0-indexed)
 *         proposer:
 *           type: string
 *           description: Stellar address of the proposer
 *         title:
 *           type: string
 *           maxLength: 32
 *         description:
 *           type: string
 *         status:
 *           type: string
 *           enum: [Active, Passed, Defeated, Cancelled]
 *         votes_for:
 *           type: integer
 *           description: Quadratic-weighted votes in favour
 *         votes_against:
 *           type: integer
 *           description: Quadratic-weighted votes against
 *         vote_start:
 *           type: integer
 *           description: Unix timestamp when voting opened
 *         vote_end:
 *           type: integer
 *           description: Unix timestamp when voting closes
 *
 *     QVError:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *
 *     QVSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *
 * /api/quadratic-voting/initialize:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Initialize the quadratic voting contract
 *     description: |
 *       Must be called once before any other operation. Sets the admin address,
 *       optional voting period (default 7 days), and optional max credits per voter
 *       per proposal (default 100).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin]
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: Deployed contract address
 *               admin:
 *                 type: string
 *                 description: Admin Stellar address
 *               votingPeriod:
 *                 type: integer
 *                 description: Voting period in seconds (default 604800 = 7 days)
 *               maxCredits:
 *                 type: integer
 *                 description: Max credits per voter per proposal (default 100)
 *           example:
 *             contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
 *             admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
 *             votingPeriod: 604800
 *             maxCredits: 100
 *     responses:
 *       200:
 *         description: Contract initialized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QVSuccess'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QVError'
 *       500:
 *         description: Contract error (e.g. already initialized)
 *
 * /api/quadratic-voting/proposals:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Create a new proposal
 *     description: Admin-only. Creates a new active proposal with the configured voting period.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin, title, description]
 *             properties:
 *               contractId:
 *                 type: string
 *               admin:
 *                 type: string
 *               title:
 *                 type: string
 *                 maxLength: 32
 *               description:
 *                 type: string
 *               duration:
 *                 type: integer
 *                 description: Override voting duration in seconds
 *           example:
 *             contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
 *             admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
 *             title: "Fund public goods"
 *             description: "Allocate 10,000 XLM to public goods projects"
 *     responses:
 *       201:
 *         description: Proposal created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     proposalId:
 *                       type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Contract error
 *
 * /api/quadratic-voting/proposals/{proposalId}:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get a proposal by ID
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Proposal ID (0-indexed)
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Contract address
 *     responses:
 *       200:
 *         description: Proposal data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/QVProposal'
 *       400:
 *         description: Missing contractId or invalid proposalId
 *       404:
 *         description: Proposal not found
 *
 * /api/quadratic-voting/proposals/count:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get total proposal count
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Proposal count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *
 * /api/quadratic-voting/proposals/{proposalId}/finalize:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Finalize a proposal after voting ends
 *     description: |
 *       Anyone can call this after the voting period ends. Sets the proposal status
 *       to Passed (votes_for > votes_against) or Defeated.
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId]
 *             properties:
 *               contractId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Proposal finalized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [Passed, Defeated]
 *       500:
 *         description: Voting still active or contract error
 *
 * /api/quadratic-voting/vote:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Cast a quadratic vote
 *     description: |
 *       Spend credits to vote on a proposal. The number of votes received equals
 *       floor(sqrt(credits)). For example: 1 credit = 1 vote, 4 credits = 2 votes,
 *       9 credits = 3 votes, 100 credits = 10 votes.
 *
 *       Each voter can only vote once per proposal. Voter must be whitelisted.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, voter, proposalId, credits, isFor]
 *             properties:
 *               contractId:
 *                 type: string
 *               voter:
 *                 type: string
 *                 description: Voter's Stellar address
 *               proposalId:
 *                 type: integer
 *               credits:
 *                 type: integer
 *                 minimum: 1
 *                 description: Credits to spend (votes = floor(sqrt(credits)))
 *               isFor:
 *                 type: boolean
 *                 description: true = vote for, false = vote against
 *           example:
 *             contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
 *             voter: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
 *             proposalId: 0
 *             credits: 9
 *             isFor: true
 *     responses:
 *       200:
 *         description: Vote cast successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     votesReceived:
 *                       type: integer
 *                       description: Number of votes received (sqrt of credits)
 *                     creditsSpent:
 *                       type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Contract error (not whitelisted, already voted, etc.)
 *
 * /api/quadratic-voting/whitelist:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Add or remove a voter from the whitelist
 *     description: Admin-only. Set allow=true to add, allow=false to remove.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin, voter, allow]
 *             properties:
 *               contractId:
 *                 type: string
 *               admin:
 *                 type: string
 *               voter:
 *                 type: string
 *               allow:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Whitelist updated
 *       400:
 *         description: Validation error
 *
 * /api/quadratic-voting/whitelist/{voter}:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Check if a voter is whitelisted
 *     parameters:
 *       - in: path
 *         name: voter
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Whitelist status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     voter:
 *                       type: string
 *                     whitelisted:
 *                       type: boolean
 *
 * /api/quadratic-voting/pause:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Pause the contract (emergency)
 *     description: Admin-only. Blocks all state-changing operations.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin]
 *             properties:
 *               contractId:
 *                 type: string
 *               admin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contract paused
 *
 * /api/quadratic-voting/unpause:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Unpause the contract
 *     description: Admin-only. Resumes all operations.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin]
 *             properties:
 *               contractId:
 *                 type: string
 *               admin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contract unpaused
 *
 * /api/quadratic-voting/status:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get contract status
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contract status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     contractId:
 *                       type: string
 *                     paused:
 *                       type: boolean
 *
 * /api/quadratic-voting/credits-to-votes:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Calculate votes from credits (off-chain helper)
 *     description: Returns floor(sqrt(credits)). Useful for UI previews before submitting a vote.
 *     parameters:
 *       - in: query
 *         name: credits
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 0
 *     responses:
 *       200:
 *         description: Votes calculation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     credits:
 *                       type: integer
 *                     votes:
 *                       type: integer
 *             example:
 *               success: true
 *               data:
 *                 credits: 9
 *                 votes: 3
 */
const quadraticVotingDocs = {};
export default quadraticVotingDocs;

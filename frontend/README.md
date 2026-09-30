This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### WalletConnect

To enable WalletConnect, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to a Reown
project ID in the frontend environment. Freighter, xBull, Albedo, and Hana are
discovered automatically without this setting.

Wallet sessions persist only the public account address, selected wallet,
network, Horizon signer keys, and last-activity timestamp. Sessions expire
after 30 minutes of inactivity and are revalidated against Horizon every five
minutes on Public, Testnet, and Futurenet. A Horizon outage does not disconnect
the wallet; a missing account or changed signer set requires reconnecting.

Ledger signing requires a browser with WebHID or WebUSB support, a connected
Ledger device, and the Stellar app open. The signing stage waits up to 120
seconds for the device confirmation and keeps the review dialog open while
Ledger is processing the APDU request.

Wallet Management streams native and trustline balances from Horizon, polls
tracked Stellar Asset Contracts through Soroban RPC, and uses XLM/USD plus
Horizon DEX quotes when available. Custom SAC contract metadata is stored in
browser local storage per account and network; prices that have no configured
Stellar market pair remain unavailable instead of being estimated.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

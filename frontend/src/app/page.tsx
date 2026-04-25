"use client";

import nextDynamic from "next/dynamic";

const Home = nextDynamic(() => import("./PlaygroundClient"), { ssr: false });

export default Home;

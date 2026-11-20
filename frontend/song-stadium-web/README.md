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

## Game page preview

Run `npm run dev` in this directory and open [http://localhost:3000/dev/game](http://localhost:3000/dev/game). No backend, Redis, queue, or second player is needed. This route is available only in development; production builds return a 404.

The toolbar switches between playing, waiting for the opponent, round completion, final results, opponent departure, connection loss, and game errors. Adjust the round, clue, remaining time, and scores. The timer is frozen by default so you can style the screen without a deadline. Turn on **Audio error** to preview audio failure/retry controls.

Song search, guesses, clue skipping, waveform, playback, and volume work with local sample data and a generated audio tone. Select **Passionfruit** for a correct guess. **Requeue** and **Reset preview** reset the local preview.

Edit `src/app/game/[roomId]/GameRoom.tsx` for the game markup, its `ClueAudio.tsx` / `SongSearch.tsx` components, or `src/app/components/listening-room.css` for styling. The preview and real matches render the same components and update as you save. The original `page.tsx` handles the room URL and mounts `GameRoom`.

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

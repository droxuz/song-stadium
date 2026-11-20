import { notFound } from "next/navigation";
import GamePreview from "./GamePreview";

export default function GamePreviewPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <GamePreview />;
}

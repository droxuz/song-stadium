"use client";

import { useEffect, useRef } from "react";
import { createSkylineRenderer, type SkylineVariant } from "@/lib/pixel-skyline";
import "./pixel-skyline.css";

const FPS = 24; // stepped frame rate keeps the motion feeling "16-bit"

export function PixelSkyline({
    variant = "auto",
    seed = 416,
    className = "",
    label = "Pixel art Toronto skyline with the CN Tower and Rogers Centre over Lake Ontario",
}: {
    /** "auto" uses the night scene between 7pm and 6am local time. */
    variant?: SkylineVariant | "auto";
    /** Change to get a different procedurally generated skyline. */
    seed?: number;
    className?: string;
    label?: string;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;

        const hour = new Date().getHours();
        const resolved: SkylineVariant = variant === "auto" ? (hour >= 19 || hour < 6 ? "night" : "sunset") : variant;
        const renderer = createSkylineRenderer(canvas, { variant: resolved, seed });
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

        let raf = 0;
        let visible = true;
        let last = 0;
        const start = performance.now();
        const STILL_TIME = 14; // frame shown when motion is reduced

        const draw = (t: number) => renderer.render(t);

        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            if (now - last < 1000 / FPS) return;
            last = now;
            draw((now - start) / 1000);
        };

        const startLoop = () => {
            cancelAnimationFrame(raf);
            if (reduceMotion.matches || !visible) {
                draw(STILL_TIME);
                return;
            }
            raf = requestAnimationFrame(loop);
        };

        const resizeObserver = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            renderer.resize(width, height);
            draw(reduceMotion.matches ? STILL_TIME : (performance.now() - start) / 1000);
        });
        resizeObserver.observe(wrap);

        const intersection = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            startLoop();
        });
        intersection.observe(wrap);

        reduceMotion.addEventListener("change", startLoop);
        startLoop();

        return () => {
            cancelAnimationFrame(raf);
            resizeObserver.disconnect();
            intersection.disconnect();
            reduceMotion.removeEventListener("change", startLoop);
        };
    }, [variant, seed]);

    return (
        <div ref={wrapRef} className={`pixel-skyline ${className}`}>
            <canvas ref={canvasRef} role="img" aria-label={label} />
        </div>
    );
}

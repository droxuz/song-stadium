"use client";

import { useParams } from "next/navigation";
import { useSocket } from "../../SocketProvider";
import { useEffect } from 'react';

export default function GamePage() {
    const { roomId } = useParams<{ roomId: string }>();
    const socket = useSocket();
    const song = null;
    
    return(
        <h1>Game: {roomId}</h1>
    ) 
}
"use client"
import{createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import{io, type Socket} from 'socket.io-client'
import { usePathname } from 'next/navigation';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({children}: {children: ReactNode}){
    const pathname = usePathname();
    const preview = process.env.NODE_ENV === 'development' && pathname === '/dev/game';
    const [socket] = useState(() => io("http://localhost:3001", {autoConnect: false}));
    useEffect(() => {
        if (preview) return;
        socket.connect();

        return () => {
            socket.disconnect()
        };
    }, [preview, socket]);
    return(<SocketContext.Provider value={preview ? null : socket}>{children}</SocketContext.Provider>)
}

export function useSocket() {
    return useContext(SocketContext)
}

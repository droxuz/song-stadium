"use client"
import{createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import{io, type Socket} from 'socket.io-client'

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({children}: {children: ReactNode}){
    const [socket, setSocket] = useState<Socket | null>(null);
    useEffect(() => {
        const connection = io("http://localhost:3001", {autoConnect: false});

        setSocket(connection)
        connection.connect();

        return () => {
            connection.disconnect()
            connection.removeAllListeners()
        };
    }, []);
    return(<SocketContext.Provider value={socket}>{children}</SocketContext.Provider>)
}

export function useSocket() {
    return useContext(SocketContext)
}
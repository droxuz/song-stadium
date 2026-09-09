import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.send('Hello World');
});

io.on('connection', (socket) => {
    console.log(`Player Connected ${socket.id}`);
});

const PORT = 3001;

server.listen(PORT, () => {
    console.log(`Server running: ${PORT}`);
});

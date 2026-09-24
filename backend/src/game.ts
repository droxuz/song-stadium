import type {Socket} from 'socket.io'

export interface GameState {
    roomId: string;
    status: "playing" | "finished"
    roundNumber: number;
    correctSongId: string; // Server 
    roundEndsAt: number;
    players: Record<string, {
        score: number;
        clueIndex: number;
        finishedRound: boolean;
    }>;
};

const clueIndex = [
    {seconds: 0.1, multiplier: 1.0},
    {seconds: 0.2, multiplier: 0.80},
    {seconds: 0.5, multiplier: 0.6},
    {seconds: 1, multiplier: 0.4},
    {seconds: 5, multiplier: 0.2}
]

export function createGameState(
    roomId: string,
    playerIDs: [string, string],
    correctSongId: string,
    roundDuration: number,
): GameState {
    return{
    roomId,
    status: "playing",
    roundNumber: 1,
    correctSongId,
    roundEndsAt: Date.now()+roundDuration,
    players: Object.fromEntries(playerIDs.map((playerID) => [playerID, {score: 0, clueIndex: 0, finishedRound: false}]))// Creates mapping of players from the game lobby
    }
}
    function submitGuess(game: GameState, playerID: string, song: string, roundNumber: number){
        const player = game.players[playerID]
        if (!player || game.status !== "playing" || game.roundNumber !== roundNumber || Date.now() > game.roundEndsAt || player.finishedRound){
            return{accepted: false}
        }
        if(song !== game.correctSongId){
            skipClue(game, playerID, roundNumber)
        }
        // 500 max points per round 5 rounds total 2500
        const score = Math.round(500 * clueIndex[player.clueIndex]!.multiplier);
        player.score += score;
        player.finishedRound = true;
        return{accepted: true, correct: true, score}
    }

    async function skipClue(game: GameState, playerID: string, roundNumber: number){

    }
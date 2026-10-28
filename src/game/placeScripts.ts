// Skrypty Luau miejsca wczytywane jako tekst (Vite `?raw`).
import coins from './scripts/server/Coins.server.lua?raw'
import killBrick from './scripts/server/KillBrick.server.lua?raw'
import movingPlatform from './scripts/server/MovingPlatform.server.lua?raw'
import gameService from './scripts/server/GameService.server.lua?raw'
import hud from './scripts/client/Hud.client.lua?raw'
import type { PlaceScripts } from './place'

export const GAME_SCRIPTS: PlaceScripts = { coins, killBrick, movingPlatform, gameService, hud }

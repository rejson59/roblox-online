// Pliki Luau wczytywane jako tekst (Vite `?raw`). Trzymamy je osobno, żeby
// testy w Node mogły wstrzyknąć źródła z dysku.
import runtime from './lua/runtime.lua?raw'
import services from './lua/services.lua?raw'
import exports from './lua/exports.lua?raw'

export const LUA_SOURCES = { runtime, services, exports }

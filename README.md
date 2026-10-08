# Ajedrez Naval

Webapp jugable del juego de mesa argentino "Ajedrez Naval" para dos jugadores (hot-seat).

## Inicio rápido

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 38 tests del motor de reglas
```

## Ajustar islas del tablero original

Editá `src/config/boardConfig.ts`, array `islands`. Cada elemento es `{ cells: Cell[] }`.  
La **simetría rotacional 180°** requiere que por cada isla en `(r,c)` exista su par en `(21-r, 25-c)`.

```ts
islands: [
  { cells: [{ r: 5, c: 3 }, { r: 5, c: 4 }, { r: 6, c: 3 }] },        // isla A
  { cells: [{ r: 16, c: 22 }, { r: 16, c: 21 }, { r: 15, c: 22 }] },   // rot(A)
]
```

## Opciones de §10

Pasalas al llamar `store.resetGame(options)`:

| Opción | Default | Descripción |
|--------|---------|-------------|
| `useDice` | `false` | `true` = dados en vez de fichas-número |
| `advancedActualRange` | `false` | `true` = comparar alcance actual (con avería) en combate |
| `randomIslands` | `false` | `true` = islas aleatorias simétricas |
| `presentation.handoffPin` | `false` | `true` = PIN en pantalla de traspaso |

## Arquitectura

```
src/
  config/boardConfig.ts   — geometría del tablero, alcances
  engine/                 — motor de reglas puro (sin React)
    types.ts              — Piece, GameState, etc.
    board.ts              — mapa de celdas, getSetupCells, generateRandomIslands
    pieces.ts             — flota, categorías, alcances, etiquetas
    lineOfSight.ts        — línea de tiro ortogonal con bloqueos
    combat.ts             — tabla de combate (§9)
    movement.ts           — movimiento, costo, applyMove
    tokens.ts             — fichas-número, transferencia, olvidos
    gameEngine.ts         — transiciones de estado completas
  store/gameStore.ts      — Zustand store (UI ↔ motor)
  ui/
    components/           — Board, PieceToken, ActionPanel, GameLog
    screens/              — SetupScreen, HandoffScreen, GameScreen
  tests/engine.test.ts    — 38 tests (Vitest)
```

# CollabWish JSON API (no database)

- **Storage**: JSON files on disk (`data/store.json`), with in-memory caching.
- **Schema parity** with your diagram: User, Product, ShopList, ShopListItem, Reactions, Suggestions.
- **Realtime**: Socket.IO rooms per list.
- **Auth**: JWT (login by phone+name).

## Run
```bash
npm i
cp .env.example .env
npm run reset   # optional: resets data/store.json with seed data
npm run dev     # http://localhost:4000
```

## Endpoints
- `POST /auth/login` `{ phoneNumber, name }` → `{ token, user }`
- `GET /products`
- `GET /lists` (auth)
- `POST /lists` (auth) `{ name, visibility }`
- `DELETE /lists/:id` (auth)
- `POST /lists/:id/join` (auth)
- `GET /lists/:id/items` (auth)
- `POST /lists/:id/items` (auth) `{ productId }`
- `DELETE /items/:itemId` (auth)
- `POST /items/:itemId/react` (auth) `{ kind: "LIKE"|"DISLIKE" }`
- `POST /items/:itemId/suggest` (auth) `{ productId }`

## Socket.IO
```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { auth: { token: JWT } });
socket.emit("join_list", listId);
socket.on("item:added", console.log);
```

### Files
- `data/seed.json` — initial dataset
- `data/store.json` — live store (auto-created on first run)

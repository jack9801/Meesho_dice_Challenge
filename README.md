# Meesho Dice Chaleege ShopList

A full-stack collaborative shopping list and product recommendation platform inspired by Meesho. This project includes:
- **Backend**: Node.js/Express API with real-time features and JSON file storage
- **Frontend**: React + Vite SPA for user interaction
- **Recommendation Engine**: (Prototype) for product suggestions

---

## Table of Contents
- [Features](#features)
- [Project Structure](#project-structure)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Recommendation Engine](#recommendation-engine)
- [API Endpoints](#api-endpoints)
- [Socket.IO Usage](#socketio-usage)
- [Data Files](#data-files)

---

## Features
- User authentication (JWT, phone + name)
- Collaborative shopping lists (create, join, manage)
- Product catalog
- Real-time updates via Socket.IO
- Product reactions (like/dislike)
- Product suggestions
- No database: uses JSON files for storage

---

## Project Structure
```
Meesho-Dice-Chaleege-shopList/
├── Backend/                # Node.js/Express API
│   ├── data/               # JSON data files
│   ├── src/                # Source code
│   ├── package.json        # Backend dependencies
│   └── README.md           # Backend instructions
├── Frontend/               # React + Vite app
│   ├── public/             # Static assets
│   ├── src/                # React source code
│   ├── package.json        # Frontend dependencies
│   └── README.md           # Frontend instructions
├── Recommendation Engine/  # (Prototype) Product matcher
│   └── Matcher (1).ipynb   # Jupyter notebook
├── meesho_dataset.json     # Product data
├── README.md               # Project overview (this file)
```

---

## Backend Setup
1. Open a terminal in `Meesho-Dice-Chaleege-shopList/Backend`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment variables:
   ```bash
   cp .env.example .env
   # Edit .env as needed (PORT, JWT_SECRET, etc.)
   ```
4. (Optional) Reset data to seed:
   ```bash
   npm run reset
   ```
5. Start the server:
   ```bash
   npm run dev
   # Server runs at http://localhost:4000
   ```

---

## Frontend Setup
1. Open a terminal in `Meesho-Dice-Chaleege-shopList/Frontend`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   # App runs at http://localhost:5173
   ```
4. Configure API URL if needed in `.env` or `vite.config.js`

---

## Recommendation Engine
- Prototype for product recommendations using Jupyter Notebook
- See `Recommendation Engine/Matcher (1).ipynb`
- Data: `Recommendation Engine/data2.json`

---

## API Endpoints (Backend)
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

---

## Socket.IO Usage
```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { auth: { token: JWT } });
socket.emit("join_list", listId);
socket.on("item:added", console.log);
```

---

## Data Files
- `Backend/data/seed.json` — initial dataset
- `Backend/data/store.json` — live store (auto-created)
- `meesho_dataset.json`, `meesho_dataset_100.json`, `meesho_dataset_100.csv` — product data

---



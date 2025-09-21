require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const JWT_SECRET = process.env.JWT_SECRET || "dev";
const DEFAULTS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const ENV_LIST = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const ALLOW = new Set([...DEFAULTS, ...ENV_LIST]);
const LOCALHOST_REGEX = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

const originChecker = (origin, cb) => {
  // No Origin (curl/Postman) => allow
  if (!origin) return cb(null, true);
  if (ALLOW.has(origin) || LOCALHOST_REGEX.test(origin)) {
    return cb(null, true);
  }
  console.warn("[CORS] Blocked origin:", origin);
  cb(new Error("Not allowed by CORS"));
};

app.use(
  cors({
    origin: originChecker,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(morgan("dev"));

app.use(
  "/images",
  express.static(path.join(__dirname, "..", "images"), { fallthrough: true })
);

/* -------------------- JSON file store ------------------- */
const DATA_PATH = path.join(__dirname, "..", "data", "store.json");
const SEED_PATH = path.join(__dirname, "..", "data", "seed.json");

const defaultData = {
  users: [],              // {id, phoneNumber, name, email, profilePictureUrl, createdAt, updatedAt, shopListIds: []}
  products: [],           // {id, name, price, mrp, rating, inStock, imageUrl}
  shopLists: [],          // {id, name, visibility, ownerId, createdAt, updatedAt, participantIds: []}
  shopListItems: [],      // {id, productId, shopListId, addedByUserId, addedAt}
  reactions: [],          // {userId, itemId, kind: "LIKE"|"DISLIKE"}
  suggestions: [],        // {id, itemId, suggestedProductId, byUserId, ts}
};

async function loadStore() {
  try {
    const buf = await fs.readFile(DATA_PATH, "utf8");
    return JSON.parse(buf);
  } catch {
    // first run: seed from seed.json or default
    let seed = defaultData;
    try {
      seed = JSON.parse(await fs.readFile(SEED_PATH, "utf8"));
    } catch {}
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
    await fs.writeFile(DATA_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
}

async function saveStore(store) {
  await fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2));
}

// in-memory store reference + lazy saves
let store = null;
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveStore(store), 400);
}

function nowISO() {
  return new Date().toISOString();
}

/* ------------------------- Auth ------------------------- */
function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ----------------------- Validators --------------------- */
const LoginBody = z.object({
  phoneNumber: z.string().min(5),
  name: z.string().min(1),
});

const CreateListBody = z.object({
  name: z.string().min(1),
  visibility: z.enum(["PRIVATE", "LINK", "PUBLIC"]).optional(),
  participantPhoneNumbers: z.array(z.string()).optional(),
});

/* ---------------------- Util helpers -------------------- */
function findOrCreateUserByPhone(phoneNumber, nameFallback = "User") {
  let u = store.users.find((x) => x.phoneNumber === phoneNumber);
  if (!u) {
    u = {
      id: uuidv4(),
      phoneNumber,
      name: nameFallback,
      email: null,
      profilePictureUrl: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      shopListIds: [],
    };
    store.users.push(u);
  }
  return u;
}

function listCounts(listId) {
  return {
    items: store.shopListItems.filter((i) => i.shopListId === listId).length,
    participants:
      store.shopLists.find((l) => l.id === listId)?.participantIds.length || 0,
  };
}

function enrichItem(i) {
  return {
    ...i,
    product: store.products.find((p) => p.id === i.productId) || null,
    reactions: store.reactions.filter((r) => r.itemId === i.id),
    suggestions: store.suggestions
      .filter((s) => s.itemId === i.id)
      .map((s) => ({
        ...s,
        product: store.products.find((p) => p.id === s.suggestedProductId) || null,
        byUser: store.users.find((u) => u.id === s.byUserId) || null,
      })),
  };
}

/* ----------------------- HTTP routes -------------------- */
// Auth
app.post("/auth/login", (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { phoneNumber, name } = parsed.data;

  let user = store.users.find((u) => u.phoneNumber === phoneNumber);
  if (!user) {
    user = {
      id: uuidv4(),
      phoneNumber,
      name,
      email: null,
      profilePictureUrl: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      shopListIds: [],
    };
    store.users.push(user);
  } else if (user.name !== name) {
    user.name = name;
    user.updatedAt = nowISO();
  }
  scheduleSave();

  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user });
});

// Products
app.get("/products", (_req, res) => {
  res.json([...store.products].sort((a, b) => Number(a.id) - Number(b.id)));
});

// Lists for current user
app.get("/lists", auth, (req, res) => {
  const userId = req.userId;
  const lists = store.shopLists.filter((l) => l.participantIds.includes(userId));
  res.json(
    lists.map((l) => ({
      ...l,
      _count: listCounts(l.id),
    }))
  );
});

// Create list (with optional participant phones)
app.post("/lists", auth, (req, res) => {
  const parsed = CreateListBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(parsed.error);

  const ownerId = req.userId;
  const name = parsed.data.name.trim();
  const visibility = parsed.data.visibility || "LINK";

  const list = {
    id: uuidv4(),
    name,
    visibility,
    ownerId,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    participantIds: [],
  };

  // add owner
  if (!list.participantIds.includes(ownerId)) list.participantIds.push(ownerId);

  // ensure owner has this list id
  const me = store.users.find((u) => u.id === ownerId);
  if (me && !me.shopListIds.includes(list.id)) me.shopListIds.push(list.id);

  // handle extra participants
  const phones = parsed.data.participantPhoneNumbers || [];
  const addedUserIds = [];
  for (const ph of phones) {
    const u = findOrCreateUserByPhone(ph, `User ${ph.slice(-4)}`);
    if (!list.participantIds.includes(u.id)) list.participantIds.push(u.id);
    if (!u.shopListIds.includes(list.id)) u.shopListIds.push(list.id);
    addedUserIds.push(u.id);
  }

  store.shopLists.unshift(list);
  scheduleSave();

  // realtime notify the owner & added users
  io.to(`user:${ownerId}`).emit("wishlist:list_created", {
    ...list,
    _count: listCounts(list.id),
  });
  for (const uid of addedUserIds) {
    io.to(`user:${uid}`).emit("wishlist:list_created", {
      ...list,
      _count: listCounts(list.id),
    });
  }

  res.status(201).json({
    ...list,
    _count: listCounts(list.id),
  });
});

// Delete list
app.delete("/lists/:id", auth, (req, res) => {
  const id = req.params.id;
  const l = store.shopLists.find((x) => x.id === id);
  if (!l) return res.status(404).json({ error: "list not found" });

  // remove related data first
  store.shopListItems = store.shopListItems.filter((i) => i.shopListId !== id);
  store.reactions = store.reactions.filter((r) =>
    store.shopListItems.some((i) => i.id === r.itemId)
  );
  store.suggestions = store.suggestions.filter((s) =>
    store.shopListItems.some((i) => i.id === s.itemId)
  );

  // remove list
  store.shopLists = store.shopLists.filter((x) => x.id !== id);

  // remove list id from users
  for (const u of store.users) {
    u.shopListIds = (u.shopListIds || []).filter((lid) => lid !== id);
  }

  scheduleSave();
  io.to(`list:${id}`).emit("wishlist:list_deleted", { id });
  res.json({ ok: true });
});

// Join list
app.post("/lists/:id/join", auth, (req, res) => {
  const listId = req.params.id;
  const userId = req.userId;
  const list = store.shopLists.find((l) => l.id === listId);
  if (!list) return res.status(404).json({ error: "list not found" });

  if (!list.participantIds.includes(userId)) list.participantIds.push(userId);

  const u = store.users.find((x) => x.id === userId);
  if (u && !u.shopListIds.includes(listId)) u.shopListIds.push(listId);

  list.updatedAt = nowISO();
  scheduleSave();

  io.to(`list:${listId}`).emit("wishlist:participant_joined", { userId, listId });
  res.json({
    ...list,
    _count: listCounts(list.id),
  });
});

// Items in a list
app.get("/lists/:id/items", auth, (req, res) => {
  const listId = req.params.id;
  const items = store.shopListItems
    .filter((i) => i.shopListId === listId)
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
    .map(enrichItem);
  res.json(items);
});

// Add item
app.post("/lists/:id/items", auth, (req, res) => {
  const listId = req.params.id;
  const productId = Number(req.body?.productId);
  if (!productId) return res.status(400).json({ error: "productId required" });

  const product = store.products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: "product not found" });

  const addedByUserId = req.userId;
  const item = {
    id: uuidv4(),
    productId,
    shopListId: listId,
    addedByUserId,
    addedAt: nowISO(),
  };
  store.shopListItems.unshift(item);
  scheduleSave();

  const payload = enrichItem(item);
  io.to(`list:${listId}`).emit("wishlist:item_added", payload);
  res.status(201).json(payload);
});

// Remove item
app.delete("/items/:itemId", auth, (req, res) => {
  const id = req.params.itemId;
  const item = store.shopListItems.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: "item not found" });

  store.shopListItems = store.shopListItems.filter((i) => i.id !== id);
  store.reactions = store.reactions.filter((r) => r.itemId !== id);
  store.suggestions = store.suggestions.filter((s) => s.itemId !== id);
  scheduleSave();

  io.to(`list:${item.shopListId}`).emit("wishlist:item_removed", { id });
  res.json({ ok: true });
});

// React like/dislike
app.post("/items/:itemId/react", auth, (req, res) => {
  const parsed = z.object({ kind: z.enum(["LIKE", "DISLIKE"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const kind = parsed.data.kind;
  const userId = req.userId;
  const itemId = req.params.itemId;

  const idx = store.reactions.findIndex((r) => r.userId === userId && r.itemId === itemId);
  if (idx >= 0 && store.reactions[idx].kind === kind) {
    // toggle off
    store.reactions.splice(idx, 1);
  } else if (idx >= 0) {
    store.reactions[idx].kind = kind;
  } else {
    store.reactions.push({ userId, itemId, kind });
  }
  scheduleSave();

  const likes = store.reactions.filter((r) => r.itemId === itemId && r.kind === "LIKE").length;
  const dislikes = store.reactions.filter((r) => r.itemId === itemId && r.kind === "DISLIKE").length;
  const payload = { itemId, likes, dislikes };

  const item = store.shopListItems.find((i) => i.id === itemId);
  if (item) io.to(`list:${item.shopListId}`).emit("wishlist:item_reacted", payload);

  res.json(payload);
});

// Suggest alternative
app.post("/items/:itemId/suggest", auth, (req, res) => {
  const parsed = z.object({ productId: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const productId = parsed.data.productId;
  const itemId = req.params.itemId;
  const byUserId = req.userId;

  if (!store.products.find((p) => p.id === productId))
    return res.status(404).json({ error: "product not found" });

  const sg = {
    id: uuidv4(),
    itemId,
    suggestedProductId: productId,
    byUserId,
    ts: nowISO(),
  };
  store.suggestions.push(sg);
  scheduleSave();

  const payload = {
    ...sg,
    product: store.products.find((p) => p.id === productId) || null,
    byUser: store.users.find((u) => u.id === byUserId) || null,
  };
  const item = store.shopListItems.find((i) => i.id === itemId);
  if (item) io.to(`list:${item.shopListId}`).emit("wishlist:item_suggested", payload);

  res.status(201).json(payload);
});

/* ----------------------- Socket.IO ---------------------- */
const io = new Server(server, {
  cors: {
    origin: originChecker,    // <-- use the same function
    credentials: true,
  },
});

io.use((socket, next) => {
  try {
    const bearer = (socket.handshake.headers.authorization || "").toString();
    const token =
      socket.handshake.auth?.token ||
      (bearer.startsWith("Bearer ") ? bearer.slice(7) : undefined);

    if (!token) return next(new Error("no token"));
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.uid;

    // join personal room
    socket.join(`user:${decoded.uid}`);

    // auto-join all list rooms this user belongs to
    const myLists = store.shopLists.filter((l) => l.participantIds.includes(decoded.uid));
    for (const l of myLists) socket.join(`list:${l.id}`);

    next();
  } catch (e) {
    next(new Error("auth failed"));
  }
});

io.on("connection", (socket) => {
  socket.on("join_list", (listId) => {
    socket.join(`list:${listId}`);
    socket.emit("joined_list", { listId });
  });
  socket.on("leave_list", (listId) => socket.leave(`list:${listId}`));
});

/* ---------------------- Boot server --------------------- */
server.listen(PORT, async () => {
  store = await loadStore();
  console.log(`JSON API listening on http://localhost:${PORT}`);
});

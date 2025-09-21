import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const RECO_URL = import.meta.env.VITE_RECO_URL || "http://localhost:53552";
const TOKEN_KEY = "cw_token";
const USER_KEY = "cw_user";


const MSH = {
  primary: "pink-600",
  primarySoft: "#8b0770",
  ratingBg: "green-600",
};

const INR = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n || 0
  );

const imgSrc = (url) => {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `${API_URL}${url}`;
};

function useToast() {
  const [toast, setToast] = useState(null); // {msg, type}
  const show = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  };
  return { toast, show, clear: () => setToast(null) };
}
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div
        className={`px-4 py-2 rounded-full shadow-lg border text-sm ${
          toast.type === "error"
            ? "bg-rose-600 text-white border-rose-700"
            : "bg-emerald-600 text-white border-emerald-700"
        }`}
      >
        {toast.msg}
      </div>
    </div>
  );
}

async function recoApi(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${RECO_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `RECO HTTP ${res.status}`);
  }
  return res.json();
}

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

/****************************\
|*      AUTH (JWT)          *|
\****************************/
function useAuth() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [me, setMe] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loggingIn, setLoggingIn] = useState(false);

  const login = async (phoneNumber, name) => {
    setLoggingIn(true);
    try {
      const { token: t, user } = await api("/auth/login", {
        method: "POST",
        body: { phoneNumber, name },
      });
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setToken(t);
      setMe(user);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken("");
    setMe(null);
  };

  return { token, me, setMe, login, logout, loggingIn };
}

/****************************\
|*     DATA + SOCKETS       *|
\****************************/
function useAppData(token) {
  const [products, setProducts] = useState([]);
  const [lists, setLists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [items, setItems] = useState([]);
  const socketRef = useRef(null);

  // ---------- upsert helpers ----------
  const upsertList = (l) =>
    setLists((prev) => {
      const i = prev.findIndex((x) => x.id === l.id);
      if (i === -1) return [l, ...prev];
      const next = prev.slice();
      next[i] = { ...prev[i], ...l };
      return next;
    });

  const removeList = (id) => setLists((prev) => prev.filter((x) => x.id !== id));

  const upsertItem = (it) =>
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === it.id);
      if (i === -1) return [it, ...prev];
      const next = prev.slice();
      next[i] = { ...prev[i], ...it };
      return next;
    });

  const removeItem = (id) => setItems((prev) => prev.filter((x) => x.id !== id));

  // ---------- initial fetch ----------
  useEffect(() => {
    if (!token) {
      setProducts([]);
      setLists([]);
      setItems([]);
      setActiveListId(null);
      return;
    }
    (async () => {
      const [ps, ls] = await Promise.all([
        api("/products"),
        api("/lists", { token }),
      ]);
      setProducts(ps);
      setLists(ls);
    })();
  }, [token]);

  // ---------- fetch items for active list ----------
  useEffect(() => {
    if (!token || !activeListId) {
      setItems([]);
      return;
    }
    (async () => {
      const its = await api(`/lists/${activeListId}/items`, { token });
      setItems(its);
    })();
  }, [token, activeListId]);

  // ---------- SOCKETS ----------
  useEffect(() => {
    if (!token) return;
    const s = io(API_URL, { auth: { token } });
    socketRef.current = s;

    const onListCreated = (list) => {
      upsertList(list);
      s.emit("join_list", list.id);
    };
    const onListDeleted = ({ id }) => {
      if (id === activeListId) setActiveListId(null);
      removeList(id);
    };
    const onParticipantJoined = ({ listId }) => {
      s.emit("join_list", listId);
    };

    const onItemAdded = (it) => {
      if (it.shopListId === activeListId) upsertItem(it);
    };
    const onItemRemoved = ({ id }) => removeItem(id);
    const onItemReacted = ({ itemId, likes, dislikes }) =>
      setItems((prev) =>
        prev.map((x) =>
          x.id === itemId ? { ...x, _likes: likes, _dislikes: dislikes } : x
        )
      );
    const onItemSuggested = (sg) =>
      setItems((prev) =>
        prev.map((x) =>
          x.id === sg.itemId
            ? { ...x, suggestions: [...(x.suggestions || []), sg] }
            : x
        )
      );

    // legacy + wishlist event names
    s.on("list:created", onListCreated);
    s.on("list:deleted", onListDeleted);
    s.on("list:participant_joined", onParticipantJoined);
    s.on("item:added", onItemAdded);
    s.on("item:removed", onItemRemoved);
    s.on("item:reaction", onItemReacted);
    s.on("item:suggested", onItemSuggested);

    s.on("wishlist:list_created", onListCreated);
    s.on("wishlist:list_deleted", onListDeleted);
    s.on("wishlist:participant_joined", onParticipantJoined);
    s.on("wishlist:item_added", onItemAdded);
    s.on("wishlist:item_removed", onItemRemoved);
    s.on("wishlist:item_reacted", onItemReacted);
    s.on("wishlist:item_suggested", onItemSuggested);

    return () => {
      [
        "list:created",
        "list:deleted",
        "list:participant_joined",
        "item:added",
        "item:removed",
        "item:reaction",
        "item:suggested",
        "wishlist:list_created",
        "wishlist:list_deleted",
        "wishlist:participant_joined",
        "wishlist:item_added",
        "wishlist:item_removed",
        "wishlist:item_reacted",
        "wishlist:item_suggested",
      ].forEach((evt) => s.off(evt));
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeListId]);

  // join socket room when switching active list
  useEffect(() => {
    const s = socketRef.current;
    if (s && activeListId) s.emit("join_list", activeListId);
  }, [activeListId]);

  // ---------- actions ----------
  const actions = useMemo(
    () => ({
      async refreshLists() {
        if (!token) return;
        const ls = await api("/lists", { token });
        setLists(ls);
      },
      async createList(name, participantPhoneNumbers = []) {
        const list = await api("/lists", {
          method: "POST",
          token,
          body: { name, visibility: "LINK", participantPhoneNumbers },
        });
        upsertList(list);
        socketRef.current?.emit("join_list", list.id);
        return list.id;
      },
      async deleteList(id) {
        await api(`/lists/${id}`, { method: "DELETE", token });
        removeList(id);
        if (activeListId === id) setActiveListId(null);
      },
      async joinList(id) {
        const l = await api(`/lists/${id}/join`, { method: "POST", token });
        upsertList(l);
        socketRef.current?.emit("join_list", id);
      },
      async addItem(listId, productId) {
        const it = await api(`/lists/${listId}/items`, {
          method: "POST",
          token,
          body: { productId: Number(productId) },
        });
        if (listId === activeListId) upsertItem(it);
      },
      async removeItem(itemId) {
        await api(`/items/${itemId}`, { method: "DELETE", token });
        removeItem(itemId);
      },
      async toggleReaction(itemId, kind /* "like" | "dislike" */) {
        const payload = await api(`/items/${itemId}/react`, {
          method: "POST",
          token,
          body: { kind: kind.toUpperCase() }, // LIKE | DISLIKE
        });
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? { ...it, _likes: payload.likes, _dislikes: payload.dislikes }
              : it
          )
        );
      },
      async addSuggestion(itemId, productId) {
        const sg = await api(`/items/${itemId}/suggest`, {
          method: "POST",
          token,
          body: { productId: Number(productId) },
        });
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? { ...it, suggestions: [...(it.suggestions || []), sg] }
              : it
          )
        );
      },
    }),
    [token, activeListId]
  );

  return {
    products,
    lists,
    items,
    activeListId,
    setActiveListId,
    actions,
    setLists,
  };
}

/****************************\
|*         UI PARTS         *|
\****************************/
function TopBar({ me, onLoginClick, onLogout, tab, setTab }) {
  return (
    <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className={`text-2xl font-extrabold text-${MSH.primary}`}>meesho</div>
        <div className="ml-6 flex items-center gap-4 text-sm">
          <button
            className={`px-3 py-1.5 rounded-full border ${
              tab === "products" ? "bg-pink-50 text-pink-700 border-pink-200" : ""
            }`}
            onClick={() => setTab("products")}
          >
            Products
          </button>
          <button
            className={`px-3 py-1.5 rounded-full border ${
              tab === "lists" ? "bg-pink-50 text-pink-700 border-pink-200" : ""
            }`}
            onClick={() => setTab("lists")}
          >
            Shoplists
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-600">{me?.name || "Guest"}</span>
          {me ? (
            <button className="px-4 py-1.5 rounded-full border" onClick={onLogout}>
              Logout
            </button>
          ) : (
            <button
              className={`px-4 py-1.5 rounded-full bg-${MSH.primary} text-white hover:opacity-95 shadow-sm`}
              onClick={onLoginClick}
            >
              Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginFormModal({ open, onClose, onSubmit, loading }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone.trim() || !name.trim()) return;
    await onSubmit(phone.trim(), name.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b">
          <div className="text-lg font-semibold">Login with Phone</div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Phone number</label>
            <input
              type="tel"
              inputMode="tel"
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-600">Your name</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Priya"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="pt-2 flex gap-2 justify-end">
            <button type="button" className="px-3 py-1.5" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-4 py-1.5 rounded-lg bg-pink-600 text-white ${
                loading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {loading ? "Logging in..." : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateShoplistModal({ open, onClose, onCreate, loading }) {
  const [name, setName] = useState("");
  const [phones, setPhones] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setPhones("");
    }
  }, [open]);

  if (!open) return null;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const list = phones
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await onCreate(name.trim(), list);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b">
          <div className="text-lg font-semibold">Create Shoplist</div>
        </div>
        <form onSubmit={handleCreate} className="p-5 space-y-3">
          <div className="space-y-1">
            <label className="text-sm text-gray-600">List name</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Diwali Gifts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">
              Add members by phone (comma-separated)
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="9876543210, 9988776655"
              value={phones}
              onChange={(e) => setPhones(e.target.value)}
            />
          </div>
          <div className="pt-2 flex gap-2 justify-end">
            <button type="button" className="px-3 py-1.5" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-4 py-1.5 rounded-lg bg-pink-600 text-white ${
                loading ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChooseListModal({ open, lists, onPick, onCreateNew, onClose }) {
  const [query, setQuery] = useState("");
  if (!open) return null;

  const filtered =
    query.trim().length > 0
      ? lists.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
      : lists;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <div className="text-lg font-semibold">Add to Shoplist</div>
          <button className="ml-auto text-gray-600" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Search your lists…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {lists.length === 0 && (
            <div className="text-sm text-gray-500 border rounded-xl p-3">
              You don’t have any shoplists yet.
            </div>
          )}

          <div className="space-y-2 max-h-80 overflow-auto">
            {filtered.map((l) => (
              <button
                key={l.id}
                className="w-full text-left rounded-xl border hover:shadow px-4 py-3 flex items-center gap-3"
                onClick={() => onPick(l.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{l.name}</div>
                  <div className="text-xs text-gray-500">
                    Items: {l._count?.items ?? 0} · Members:{" "}
                    {l._count?.participants ?? l.participantIds?.length ?? 1}
                  </div>
                </div>
                <span className="text-pink-600">+</span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 pb-4">
          <button
            className="w-full rounded-full border border-pink-600 text-pink-600 font-medium px-4 py-3 bg-white hover:bg-pink-50"
            onClick={onCreateNew}
          >
            + Create new shoplist
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareLink({ listId }) {
  const url = `${location.origin}${location.pathname}?listId=${listId}`;
  return (
    <button
      className={`px-3 py-1.5 rounded-full border border-pink-600 text-pink-600 hover:bg-pink-50`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          alert("Invite link copied!");
        } catch {
          prompt("Copy link:", url);
        }
      }}
    >
      🔗 Invite
    </button>
  );
}

function ProductCard({ p, onAdd }) {
  const hasMrp = Number(p.mrp) > Number(p.price);
  const discountPct = hasMrp ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-white shadow hover:shadow-md transition flex flex-col">
      <div className="relative aspect-[4/5] bg-gray-50 overflow-hidden">
        <img
          src={imgSrc(p.imageUrl)}
          alt={p.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {hasMrp && (
          <div
            className={`absolute left-2 top-2 text-[11px] font-semibold text-${MSH.primary} bg-${MSH.primarySoft} border border-pink-200 px-2 py-1 rounded`}
          >
            {discountPct}% OFF
          </div>
        )}
        <div className="absolute right-2 top-2 flex flex-col gap-2">
          <button
            type="button"
            className="h-9 w-9 grid place-items-center rounded-full bg-pink-600 text-white shadow"
            title="Add to list"
            onClick={(e) => {
              e.stopPropagation();
              onAdd?.();
            }}
          >
            +
          </button>
        </div>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-1">
        <div className="font-medium leading-snug line-clamp-2">{p.name}</div>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-${MSH.ratingBg} text-white text-xs`}
          >
            ⭐ {typeof p.rating === "number" ? p.rating.toFixed(1) : "—"}
          </span>
          {p.likes ? <span className="text-gray-500 text-xs">({p.likes})</span> : null}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-lg font-bold">{INR(p.price)}</div>
          {hasMrp && (
            <div className="text-sm text-gray-400 line-through">{INR(p.mrp)}</div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
            Free Delivery
          </span>
          <span
            className={`ml-auto text-[11px] ${
              p.inStock ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {p.inStock ? "In stock" : "Out of stock"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ListCard({ list, itemsCount, onDelete, onOpen, onInvite }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-white shadow-sm hover:shadow-md transition">
      <div className={`px-3 pt-3`}>
        <span className={`inline-flex items-center gap-1 text-xs font-medium bg-pink-50 text-pink-600 border border-pink-200 px-2 py-1 rounded-full`}>
          👜 {itemsCount} item{itemsCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="p-3 pt-2">
        <div className="font-semibold leading-snug truncate">{list.name}</div>
        <div className="text-xs text-gray-500">
          Members: {list._count?.participants ?? list.participantIds?.length ?? 1}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={() => onOpen?.(list.id)}
          >
            View
          </button>
          <button
            className={`rounded-full border px-3 py-1.5 text-sm text-pink-600 hover:bg-pink-50`}
            onClick={() => onInvite?.(list.id)}
          >
            Invite
          </button>
          <button
            className="ml-auto rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={() => onDelete(list.id)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemCard({ it, onReact, onSuggest, onRemove }) {
  const p = it.product || {};
  const likeCount =
    it._likes ?? (it.reactions?.filter((r) => r.kind === "LIKE").length || 0);
  const dislikeCount =
    it._dislikes ?? (it.reactions?.filter((r) => r.kind === "DISLIKE").length || 0);

  return (
    <div className="rounded-2xl border bg-white shadow hover:shadow-md transition overflow-hidden">
      <div className="p-3 flex gap-3">
        <div className="w-28 h-20 rounded-xl overflow-hidden bg-gray-50 shrink-0">
          {p.imageUrl ? (
            <img
              src={imgSrc(p.imageUrl)}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-gray-400 text-sm">
              No image
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{p.name || "Untitled"}</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="text-gray-800 font-semibold">
              {INR(Number(p.price) || 0)}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-${MSH.ratingBg} text-white text-xs`}
            >
              ⭐ {typeof p.rating === "number" ? p.rating.toFixed(1) : p.rating ?? "—"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button
              className="rounded-full border px-3 py-1 hover:bg-pink-50"
              onClick={() => onReact(it.id, "like")}
            >
              👍 {likeCount}
            </button>
            <button
              className="rounded-full border px-3 py-1 hover:bg-gray-50"
              onClick={() => onReact(it.id, "dislike")}
            >
              👎 {dislikeCount}
            </button>
            <button
              className="rounded-full border px-3 py-1 hover:bg-pink-50 text-pink-600"
              onClick={() => {
                const prodId = Number(
                  prompt("Suggest alternative: enter product numeric id (e.g., 2)")
                );
                if (!prodId) return;
                onSuggest(it.id, prodId);
              }}
            >
              💡 Suggest
            </button>
            <button
              className="ml-auto rounded-full border px-3 py-1 hover:bg-gray-50"
              onClick={() => onRemove(it.id)}
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      {Array.isArray(it.suggestions) && it.suggestions.length > 0 && (
        <div className="px-3 pb-3 text-sm">
          <div className="font-medium mb-1">Suggestions</div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {it.suggestions.map((s) => (
              <div key={s.id} className="min-w-[180px] border rounded-xl p-2 bg-white">
                <div className="text-xs text-gray-500">by {s.byUser?.name || "User"}</div>
                <div className="truncate font-medium">{s.product?.name || "Untitled"}</div>
                <div className="text-xs text-gray-600">
                  {Number.isFinite(s.product?.price) ? INR(s.product.price) : "—"} · ⭐{" "}
                  {typeof s.product?.rating === "number"
                    ? s.product.rating.toFixed(1)
                    : s.product?.rating ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ListDetail({
  list,
  items,
  onBack,
  onReact,
  onSuggest,
  onRemove,
  onAddItem,            // NEW
  fetchRecommendations, // NEW
}) {
  const count = items.length;
  const subtotal = items.reduce((s, it) => s + (it.product?.price || 0), 0);

  // --- Recommendations state ---
  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState("");

  // Fetch recommendations whenever the list changes or the product set changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setRecsLoading(true);
        setRecsError("");

        // ✅ build product objects (not just IDs)
        const productsArray = items
          .map((it) => it.product)
          .filter(Boolean);

        if (!productsArray.length) {
          setRecs([]);
          return;
        }

        // ✅ call backend with proper payload
        const r = await fetchRecommendations?.(list.id, productsArray);
        if (!cancelled) setRecs(r.recommendations);
      } catch (e) {
        if (!cancelled)
          setRecsError(e?.message || "Failed to load recommendations");
      } finally {
        if (!cancelled) setRecsLoading(false);
      }
    }

    if (items.length) load();
    else {
      setRecs([]);
      setRecsError("");
    }

    return () => {
      cancelled = true;
    };
  }, [list.id, items, fetchRecommendations]);

  return (
    <div id={`list-${list.id}`} className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="px-3 py-1.5 rounded-full border hover:bg-pink-50"
          onClick={onBack}
        >
          ← Back
        </button>
        <div className="text-xl font-semibold">{list.name}</div>
        <div className="ml-auto flex items-center gap-2">
          <ShareLink listId={list.id} />
          <span className="text-sm text-gray-500">
            Members: {list._count?.participants ??
              list.participantIds?.length ??
              1}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center rounded-full bg-pink-50 text-pink-600 px-3 py-1 border border-pink-200">
          {count} item{count === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-800 px-3 py-1 border border-sky-200">
          Subtotal: {INR(subtotal)}
        </span>
      </div>

      {/* Items */}
      {count === 0 ? (
        <div className="text-sm text-gray-600 border rounded-2xl p-6 bg-white shadow-sm text-center">
          <div className="font-medium mb-1">No items yet</div>
          <div className="text-gray-500">Add from the product grid.</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <ItemCard
              key={it.id}
              it={it}
              onReact={onReact}
              onSuggest={onSuggest}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {/* More like this */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-semibold">More like this</h3>
          {recsLoading && (
            <span className="text-sm text-gray-500">loading…</span>
          )}
          {recsError && (
            <span className="text-sm text-rose-600">{recsError}</span>
          )}
        </div>

        {!recsLoading && recs?.length === 0 ? (
          <div className="text-sm text-gray-500 border rounded-xl p-3">
            No recommendations right now.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {recs.map((p) => (
              <div key={p.id} className="relative">
                <div className="rounded-xl border bg-white overflow-hidden shadow-sm">
                  <div className="aspect-[4/5] bg-gray-50">
                    <img
                      src={imgSrc(p.imageUrl)}
                      alt={p.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-2">
                    <div className="text-sm font-medium line-clamp-2">
                      {p.name}
                    </div>
                    <div className="text-sm mt-1 font-semibold">
                      {INR(p.price)}
                    </div>
                    <div className="mt-2">
                      <button
                        className="w-full rounded-full bg-pink-600 text-white text-sm py-1.5"
                        onClick={() => onAddItem?.(p.id)}
                      >
                        Add to this list
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/****************************\
|*         ROOT APP         *|
\****************************/
export default function App() {
  const { token, me, login, logout, loggingIn } = useAuth();
  const { products, lists, items, activeListId, setActiveListId, actions } =
    useAppData(token);
  const { toast, show } = useToast();

  const [tab, setTabState] = useState("products"); // "products" | "lists"

  // Modals
  const [loginOpen, setLoginOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [chooseForPid, setChooseForPid] = useState(null);
  const [pendingCreateAfterChoose, setPendingCreateAfterChoose] = useState(false);

  // Invite deep link (?listId=...)
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(location.search);
    const lid = params.get("listId");
    if (lid) actions.joinList(lid).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const activeList = activeListId ? lists.find((l) => l.id === activeListId) : null;

  const setTab = async (t) => {
    setTabState(t);
    if (t === "lists" && token) {
      try {
        await actions.refreshLists(); // pull fresh lists whenever user opens the tab
      } catch {}
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        me={me}
        onLoginClick={() => setLoginOpen(true)}
        onLogout={logout}
        tab={tab}
        setTab={setTab}
      />

      <div className="max-w-6xl mx-auto p-4">
        {/* Tabs */}
        {tab === "products" && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">Products</div>
              <div className="ml-auto text-sm text-gray-500">
                {token ? "Pick any product and add to your shoplist." : "Login to manage lists."}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  onAdd={() => {
                    if (!me) return setLoginOpen(true);
                    setChooseForPid(p.id);
                    setChooseOpen(true);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {tab === "lists" && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Lists column */}
            <div className="lg:col-span-1 space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold">Your Shoplists</div>
                <button
                  className="ml-auto px-3 py-1.5 rounded-full border"
                  onClick={() => {
                    if (!token) return setLoginOpen(true);
                    setCreateOpen(true);
                  }}
                >
                  + New
                </button>
              </div>
              {lists.length === 0 && (
                <div className="text-sm text-gray-500 border rounded-2xl p-3">
                  {token ? "No lists yet — create one!" : "Login to manage your lists."}
                </div>
              )}
              <div className="space-y-3">
                {lists.map((l) => {
                  const itemsCount = l._count?.items ?? 0;
                  return (
                    <div
                      key={l.id}
                      className={`${activeListId === l.id ? "ring-2 ring-pink-200" : ""} rounded-2xl`}
                    >
                      <ListCard
                        list={l}
                        itemsCount={itemsCount}
                        onOpen={(id) => {
                          setActiveListId(id);
                        }}
                        onInvite={(id) => {
                          const url = `${location.origin}${location.pathname}?listId=${id}`;
                          navigator.clipboard
                            ?.writeText(url)
                            .then(
                              () => show("Invite link copied!"),
                              () => prompt("Copy link:", url)
                            );
                        }}
                        onDelete={(id) => {
                          if (confirm("Delete list?")) {
                            actions.deleteList(id).catch((e) => show(e.message, "error"));
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detail column */}
            <div className="lg:col-span-2 space-y-6">
              {!activeList ? (
                <div className="text-sm text-gray-500 border rounded-2xl p-6">
                  Select a shoplist on the left to view items.
                </div>
              ) : (
                <ListDetail
                  list={activeList}
                  items={items}
                  onBack={() => setActiveListId(null)}
                  onReact={(id, k) => actions.toggleReaction(id, k)}
                  onSuggest={(id, pid) => actions.addSuggestion(id, pid)}
                  onRemove={(id) => actions.removeItem(id)}
                  // Add to this (open) list
                  onAddItem={(productId) => actions.addItem(activeList.id, productId)}
                  // Recommender: send token + ALL current productIds
                  fetchRecommendations={async (listId, productIds) => {
                    // shape expected by your FastAPI — adjust if needed
                    // return an array of { id, name, price, imageUrl, ... }
                    return recoApi("/recommend", {
                      method: "POST",
                      body: { "items" : items.map(it => it.product) },
                    });
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <LoginFormModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSubmit={login}
        loading={loggingIn}
      />

      <CreateShoplistModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setPendingCreateAfterChoose(false);
        }}
        loading={false}
        onCreate={async (name, participantPhones) => {
          try {
            const id = await actions.createList(name, participantPhones);
            // If we are in the "add from product" flow, don't navigate — just add item & toast
            if (pendingCreateAfterChoose && chooseForPid) {
              await actions.addItem(id, chooseForPid);
              setPendingCreateAfterChoose(false);
              setChooseForPid(null);
              setCreateOpen(false);
              show("Added to new shoplist!");
              return;
            }
            // Regular create from Shoplists tab: select the new list
            setCreateOpen(false);
            setTab("lists");
            setActiveListId(id);
            show("Shoplist created");
          } catch (e) {
            show(e.message, "error");
          }
        }}
      />

      <ChooseListModal
        open={chooseOpen}
        lists={lists}
        onPick={async (listId) => {
          try {
            await actions.addItem(listId, chooseForPid);
            setChooseOpen(false);
            setChooseForPid(null);
            show("Added to shoplist!");
          } catch (e) {
            show(e.message, "error");
          }
        }}
        onCreateNew={() => {
          setChooseOpen(false);
          setPendingCreateAfterChoose(true);
          setCreateOpen(true);
        }}
        onClose={() => {
          setChooseOpen(false);
          setChooseForPid(null);
        }}
      />

      <Toast toast={toast} />
    </div>
  );
}
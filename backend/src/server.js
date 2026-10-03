require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { get } = require("@vercel/blob");
const database = require("./database");
const blobStorage = require("./blob-storage");

const app = express();
const root = path.join(__dirname, "../..");
const usesDatabase = Boolean(process.env.DATABASE_URL);
if (process.env.NODE_ENV === "production" && !usesDatabase) {
  throw new Error("Configure DATABASE_URL para iniciar o DaBrik em produção.");
}
const dataDir = path.join(root, "data");
const imageDir = path.join(root, "uploads");
const dataFile = path.join(dataDir, "marketplace.json");
const secretFile = path.join(dataDir, ".jwt-secret");
const categories = [
  "Automóveis",
  "Casa e jardim",
  "Celulares e tablets",
  "Eletrodomésticos",
  "Esportes e lazer",
  "Imóveis",
  "Moda e beleza",
  "Móveis",
  "Serviços",
  "Tecnologia",
  "Ferramentas",
  "Outros",
];

if (!usesDatabase) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  fs.mkdirSync(imageDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ users: [], products: [] }, null, 2));
  }
  fs.chmodSync(dataFile, 0o600);
}

const secret =
  process.env.JWT_SECRET ||
  (() => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Configure JWT_SECRET antes de iniciar em produção.");
    }
    if (!fs.existsSync(secretFile)) {
      fs.writeFileSync(secretFile, crypto.randomBytes(48).toString("hex"), {
        mode: 0o600,
      });
      fs.chmodSync(secretFile, 0o600);
    }
    return fs.readFileSync(secretFile, "utf8");
  })();
if (secret.length < 32) {
  throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres.");
}

function readLocalStore() {
  const store = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  store.reports ||= [];
  store.conversations ||= [];
  store.messages ||= [];
  return store;
}

function saveStore(store) {
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporaryFile, dataFile);
  fs.chmodSync(dataFile, 0o600);
}

async function readStore() {
  return usesDatabase ? database.readStore() : readLocalStore();
}

async function sendChatPushNotification(userId, conversationId, messageContent) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return;

  try {
    const messageCharacters = [...String(messageContent || "").trim()];
    const messagePreview = messageCharacters.slice(0, 400).join("");
    const notificationContent = messagePreview
      ? `Mensagem: ${messagePreview}${messageCharacters.length > 400 ? "…" : ""}`
      : "Você recebeu uma nova mensagem no DaBrik.";
    const siteUrl = new URL(process.env.DABRIK_SITE_URL || "https://llc-afk.github.io/Dabrik/");
    siteUrl.pathname = `${siteUrl.pathname.replace(/\/+$/, "")}/mensagens`;
    siteUrl.search = new URLSearchParams({ id: conversationId }).toString();
    siteUrl.hash = "";

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: "push",
        include_aliases: { external_id: [String(userId)] },
        headings: { en: "Nova mensagem no DaBrik" },
        contents: { en: notificationContent },
        url: siteUrl.toString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
    let responseBody = "";
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "[corpo da resposta indisponível]";
    }
    if (!response.ok) {
      console.warn(`[OneSignal] envio de push falhou (HTTP ${response.status}; userId=${userId}; resposta=${responseBody}).`);
    } else {
      console.info(`[OneSignal] envio de push aceito (HTTP ${response.status}; userId=${userId}).`);
    }
  } catch (error) {
    console.warn(`[OneSignal] envio de push indisponível: ${error.message}`);
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, phone: user.phone };
}

function publicProduct(product, store) {
  const user = store.users.find((item) => item.id === product.ownerId);
  return {
    ...product,
    images: (product.images || []).map((image) => {
      try {
        const url = new URL(image);
        if (url.protocol === "https:" && url.hostname.endsWith(".private.blob.vercel-storage.com")
          && /^\/dabrik\/products\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(url.pathname)) {
          return `/api/blob?pathname=${encodeURIComponent(url.pathname)}`;
        }
      } catch {
        // Caminhos locais e URLs públicas existentes seguem sem alteração.
      }
      return image;
    }),
    owner: user
      ? {
          id: user.id,
          name: user.name,
          ...(product.sharePhone ? { phone: user.phone } : {}),
        }
      : null,
  };
}

const authenticate = (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    if (!token) throw new Error("missing token");
    req.user = jwt.verify(token, secret, { issuer: "dabrik" });
    next();
  } catch {
    res.status(401).json({ error: "Entre na sua conta para continuar." });
  }
};

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,https://llc-afk.github.io")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origem não autorizada." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  if (origin && req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "4.2mb" }));
app.use(
  "/api",
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }),
);
const loginLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  message: {
    error: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  },
});
const registerLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  message: {
    error: "Limite de cadastros atingido. Tente novamente mais tarde.",
  },
});
app.use("/uploads", express.static(imageDir, { maxAge: "1d" }));

// Fotos de anúncios são públicas no marketplace, mas o token da store privada
// permanece no servidor e nunca é exposto ao navegador.
app.get("/api/blob", async (req, res, next) => {
  try {
    const pathname = String(req.query.pathname || "");
    if (!/^\/dabrik\/products\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(pathname)) {
      return res.status(404).end();
    }
    const blob = await get(pathname.replace(/^\//, ""), { access: "private" });
    if (!blob) return res.status(404).end();
    if (blob.statusCode === 304) return res.status(304).end();
    res.setHeader("Content-Type", blob.blob.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(blob.blob.size));
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("ETag", blob.blob.etag);
    await pipeline(Readable.fromWeb(blob.stream), res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (_req, res) => {
  const store = await readStore();
  res.json({
    status: "ok",
    database: usesDatabase ? "postgresql" : "local-file",
    listings: store.products.length,
  });
});

app.get("/api/categories", (_req, res) =>
  res.json({ items: categories.map((name) => ({ name })) }),
);

app.get("/api/products", async (req, res) => {
  const store = await readStore();
  const query = String(req.query.q || "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  const city = String(req.query.city || "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  const category = String(req.query.category || "").trim();
  const sort = String(req.query.sort || "recent");
  const minValue = Number(req.query.min);
  const maxValue = Number(req.query.max);
  const min =
    req.query.min && Number.isFinite(minValue) ? Math.max(0, minValue) : 0;
  const max =
    req.query.max !== undefined &&
    req.query.max !== "" &&
    Number.isFinite(maxValue)
      ? Math.max(0, maxValue)
      : Infinity;
  const items = store.products
    .filter((product) => product.status === "ACTIVE")
    .filter(
      (product) =>
        !query ||
        `${product.title} ${product.description} ${product.category}`
          .toLocaleLowerCase("pt-BR")
          .includes(query),
    )
    .filter(
      (product) =>
        !city || product.city.toLocaleLowerCase("pt-BR").includes(city),
    )
    .filter((product) => !category || product.category === category)
    .filter((product) => product.price >= min && product.price <= max)
    .sort((a, b) => {
      if (sort === "low-price") return a.price - b.price;
      if (sort === "high-price") return b.price - a.price;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .map((product) => publicProduct(product, store));
  res.json({ items, total: items.length });
});

app.get("/api/products/:id", async (req, res) => {
  const store = await readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.status === "ACTIVE",
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  res.json({ product: publicProduct(product, store) });
});

app.post("/api/products/:id/report", authenticate, async (req, res, next) => {
  try {
    const data = z.object({
      reason: z.enum(["fraud", "prohibited", "counterfeit", "misleading", "other"]),
      details: z.string().trim().max(1000).default(""),
    }).parse(req.body);
    const store = await readStore();
    const product = store.products.find(
      (item) => item.id === req.params.id && item.status === "ACTIVE",
    );
    if (!product) return res.status(404).json({ error: "Anúncio não encontrado." });
    if (product.ownerId === req.user.sub) {
      return res.status(400).json({ error: "Você não pode denunciar seu próprio anúncio." });
    }
    const report = {
      id: crypto.randomUUID(),
      productId: product.id,
      reporterId: req.user.sub,
      ...data,
      createdAt: new Date().toISOString(),
    };
    if (usesDatabase) {
      if (!(await database.createProductReport(report))) {
        return res.status(409).json({ error: "Você já denunciou este anúncio." });
      }
    } else {
      const local = readLocalStore();
      if (local.reports.some((item) => item.productId === product.id && item.reporterId === req.user.sub)) {
        return res.status(409).json({ error: "Você já denunciou este anúncio." });
      }
      local.reports.push(report);
      saveStore(local);
    }
    res.status(201).json({ message: "Denúncia enviada para análise." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations", authenticate, async (req, res, next) => {
  try {
    const data = z.object({
      productId: z.string().uuid(),
      content: z.string().trim().min(1).max(2000),
    }).parse(req.body);
    const store = await readStore();
    const product = store.products.find(
      (item) => item.id === data.productId && item.status === "ACTIVE",
    );
    if (!product) return res.status(404).json({ error: "Anúncio não encontrado." });
    if (product.ownerId === req.user.sub) {
      return res.status(400).json({ error: "Você não pode iniciar um chat com seu próprio anúncio." });
    }
    const conversation = {
      id: crypto.randomUUID(),
      productId: product.id,
      buyerId: req.user.sub,
      sellerId: product.ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let conversationId;
    if (usesDatabase) {
      conversationId = await database.createConversation(conversation);
    } else {
      const local = readLocalStore();
      const existing = local.conversations.find(
        (item) => item.productId === product.id && item.buyerId === req.user.sub,
      );
      conversationId = existing?.id || conversation.id;
      if (!existing) local.conversations.push(conversation);
      const message = {
        id: crypto.randomUUID(),
        conversationId,
        senderId: req.user.sub,
        content: data.content,
        createdAt: new Date().toISOString(),
      };
      local.messages.push(message);
      const stored = local.conversations.find((item) => item.id === conversationId);
      stored.updatedAt = message.createdAt;
      saveStore(local);
    }
    if (usesDatabase) {
      await database.createMessage({
        id: crypto.randomUUID(),
        senderId: req.user.sub,
        content: data.content,
        createdAt: new Date().toISOString(),
      }, conversationId);
    }
    await sendChatPushNotification(product.ownerId, conversationId, data.content);
    res.status(201).json({ conversationId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations", authenticate, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (usesDatabase) {
    return res.json({ items: await database.listConversations(req.user.sub) });
  }
  const store = readLocalStore();
  const items = store.conversations
    .filter((item) => item.buyerId === req.user.sub || item.sellerId === req.user.sub)
    .map((conversation) => {
      const product = store.products.find((item) => item.id === conversation.productId);
      const otherId = conversation.buyerId === req.user.sub
        ? conversation.sellerId
        : conversation.buyerId;
      const other = store.users.find((item) => item.id === otherId);
      const messages = store.messages.filter((item) => item.conversationId === conversation.id);
      return {
        id: conversation.id,
        productId: conversation.productId,
        productTitle: product?.title || "Anúncio removido",
        otherName: other?.name || "Usuário DaBrik",
        lastMessage: messages.at(-1)?.content || "",
        updatedAt: conversation.updatedAt,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ items });
});

app.get("/api/conversations/:id/messages", authenticate, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (usesDatabase) {
    const conversation = await database.findConversationForUser(req.params.id, req.user.sub);
    if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
    return res.json({ items: await database.listMessages(conversation.id) });
  }
  const store = readLocalStore();
  const conversation = store.conversations.find(
    (item) => item.id === req.params.id &&
      (item.buyerId === req.user.sub || item.sellerId === req.user.sub),
  );
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
  const items = store.messages
    .filter((item) => item.conversationId === conversation.id)
    .map((item) => ({
      ...item,
      senderName: store.users.find((user) => user.id === item.senderId)?.name || "Usuário DaBrik",
    }));
  res.json({ items });
});

app.post("/api/conversations/:id/messages", authenticate, async (req, res, next) => {
  try {
    const data = z.object({ content: z.string().trim().min(1).max(2000) }).parse(req.body);
    let recipientId;
    const message = {
      id: crypto.randomUUID(),
      senderId: req.user.sub,
      content: data.content,
      createdAt: new Date().toISOString(),
    };
    if (usesDatabase) {
      const conversation = await database.findConversationForUser(req.params.id, req.user.sub);
      if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
      recipientId = conversation.buyerId === req.user.sub
        ? conversation.sellerId
        : conversation.buyerId;
      await database.createMessage(message, conversation.id);
    } else {
      const local = readLocalStore();
      const conversation = local.conversations.find(
        (item) => item.id === req.params.id &&
          (item.buyerId === req.user.sub || item.sellerId === req.user.sub),
      );
      if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
      recipientId = conversation.buyerId === req.user.sub
        ? conversation.sellerId
        : conversation.buyerId;
      local.messages.push({ ...message, conversationId: conversation.id });
      conversation.updatedAt = message.createdAt;
      saveStore(local);
    }
    await sendChatPushNotification(recipientId, req.params.id, data.content);
    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", registerLimit, async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.string().trim().email().max(254),
        phone: z.string().trim().min(10).max(30),
        password: z.string().min(10).max(128),
      })
      .parse(req.body);
    const email = data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = {
      id: crypto.randomUUID(),
      name: data.name,
      email,
      phone: data.phone,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    if (usesDatabase) {
      if (!(await database.createUser(user))) {
        return res.status(409).json({ error: "Este e-mail já está cadastrado." });
      }
    } else {
      const store = readLocalStore();
      if (store.users.some((item) => item.email === email)) {
        return res.status(409).json({ error: "Este e-mail já está cadastrado." });
      }
      store.users.push(user);
      saveStore(store);
    }
    const token = jwt.sign({ sub: user.id }, secret, {
      expiresIn: "7d",
      issuer: "dabrik",
    });
    res.status(201).json({
      user: { id: user.id, name: user.name, email, phone: user.phone },
      token,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", loginLimit, async (req, res, next) => {
  try {
    const data = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const user = usesDatabase
      ? await database.findUserByEmail(data.email.toLowerCase())
      : readLocalStore().users.find((item) => item.email === data.email.toLowerCase());
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }
    const token = jwt.sign({ sub: user.id }, secret, {
      expiresIn: "7d",
      issuer: "dabrik",
    });
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
  const user = usesDatabase
    ? await database.findUserById(req.user.sub)
    : readLocalStore().users.find((item) => item.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: { ...publicUser(user), email: user.email } });
});

app.get("/api/my/products", authenticate, async (req, res) => {
  const store = await readStore();
  const items = store.products
    .filter((product) => product.ownerId === req.user.sub)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items, total: items.length });
});

const imageSchema = z
  .array(z.string().max(1_500_000))
  .max(5, "Adicione no máximo 5 fotos.")
  .default([]);
const productSchema = z.object({
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().min(10).max(3000),
  category: z.enum(categories),
  price: z.number().min(0).max(100_000_000),
  city: z.string().trim().min(2).max(80),
  state: z
    .string()
    .trim()
    .length(2)
    .transform((state) => state.toUpperCase()),
  images: imageSchema,
  sharePhone: z.boolean().default(false),
});

function saveLocalImages(images) {
  return images.map((image) => {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
      image,
    );
    if (!match)
      throw Object.assign(new Error("Use fotos JPG, PNG ou WebP."), {
        status: 400,
      });
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 1_000_000) {
      throw Object.assign(new Error("Cada foto precisa ter até 1 MB."), {
        status: 400,
      });
    }
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
    const matchesDeclaredType =
      (match[1] === "jpeg" && jpeg) ||
      (match[1] === "png" && png) ||
      (match[1] === "webp" && webp);
    if (!matchesDeclaredType) {
      throw Object.assign(
        new Error("O arquivo enviado não parece ser uma foto válida."),
        { status: 400 },
      );
    }
    const filename = `${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(imageDir, filename), buffer, { flag: "wx" });
    return `/uploads/${filename}`;
  });
}

app.post("/api/products", authenticate, async (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const store = usesDatabase ? null : readLocalStore();
    const id = crypto.randomUUID();
    const product = {
      id,
      ...data,
      images: usesDatabase
        ? await blobStorage.saveImages(data.images, id)
        : saveLocalImages(data.images),
      ownerId: req.user.sub,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    if (usesDatabase) {
      await database.createProduct(product);
      const current = await readStore();
      res.status(201).json({ product: publicProduct(product, current) });
    } else {
      store.products.push(product);
      saveStore(store);
      res.status(201).json({ product: publicProduct(product, store) });
    }
  } catch (error) {
    next(error);
  }
});

app.put("/api/products/:id", authenticate, async (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const store = await readStore();
    const index = store.products.findIndex(
      (item) => item.id === req.params.id && item.ownerId === req.user.sub,
    );
    if (index < 0)
      return res.status(404).json({ error: "Anúncio não encontrado." });
    const previous = store.products[index];
    const newImages = data.images.length
      ? usesDatabase
        ? await blobStorage.saveImages(data.images, previous.id)
        : saveLocalImages(data.images)
      : previous.images;
    const updated = { ...previous, ...data, images: newImages };
    if (usesDatabase) {
      const found = await database.updateProduct(req.params.id, req.user.sub, updated);
      if (!found) return res.status(404).json({ error: "Anúncio não encontrado." });
      if (data.images.length) {
        await blobStorage.deleteImages(previous.images).catch((error) => console.error(error));
      }
      const latest = await readStore();
      return res.json({ product: publicProduct(updated, latest) });
    }
    store.products[index] = updated;
    saveStore(store);
    if (data.images.length) {
      for (const image of previous.images) fs.rmSync(path.join(imageDir, path.basename(image)), { force: true });
    }
    res.json({ product: publicProduct(updated, store) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/products/:id/status", authenticate, async (req, res) => {
  const status = z
    .enum(["ACTIVE", "PAUSED", "SOLD"])
    .safeParse(req.body.status);
  if (!status.success)
    return res.status(400).json({ error: "Status inválido." });
  const store = await readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.ownerId === req.user.sub,
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  if (usesDatabase) {
    const updated = await database.updateProductStatus(req.params.id, req.user.sub, status.data);
    if (!updated) return res.status(404).json({ error: "Anúncio não encontrado." });
  } else {
    product.status = status.data;
    saveStore(store);
  }
  product.status = status.data;
  res.json({ product });
});

app.delete("/api/products/:id", authenticate, async (req, res) => {
  const store = await readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.ownerId === req.user.sub,
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  if (usesDatabase) {
    const deleted = await database.deleteProduct(product.id, req.user.sub);
    if (!deleted) return res.status(404).json({ error: "Anúncio não encontrado." });
    await blobStorage.deleteImages(product.images).catch((error) => console.error(error));
  } else {
    store.products = store.products.filter((item) => item.id !== product.id);
    store.reports = store.reports.filter((item) => item.productId !== product.id);
    const conversationIds = new Set(
      store.conversations
        .filter((item) => item.productId === product.id)
        .map((item) => item.id),
    );
    store.conversations = store.conversations.filter(
      (item) => !conversationIds.has(item.id),
    );
    store.messages = store.messages.filter(
      (item) => !conversationIds.has(item.conversationId),
    );
    saveStore(store);
    for (const image of product.images) {
      const filename = path.basename(image);
      fs.rmSync(path.join(imageDir, filename), { force: true });
    }
  }
  res.status(204).end();
});

app.use(express.static(path.join(root, "frontend")));
app.get("/{*splat}", (_req, res) =>
  res.sendFile(path.join(root, "frontend/index.html")),
);
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.issues[0].message });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: error.message || "Não foi possível concluir. Tente novamente.",
  });
});

const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(port, () =>
    console.log(`DaBrik pronto em http://localhost:${port}`),
  );
}

module.exports = app;

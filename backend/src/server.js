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

const app = express();
const root = path.join(__dirname, "../..");
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

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDir, 0o700);
fs.mkdirSync(imageDir, { recursive: true });

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(
    dataFile,
    JSON.stringify({ users: [], products: [] }, null, 2),
  );
}
fs.chmodSync(dataFile, 0o600);

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

function readStore() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function saveStore(store) {
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporaryFile, dataFile);
  fs.chmodSync(dataFile, 0o600);
}

function publicUser(user) {
  return { id: user.id, name: user.name, phone: user.phone };
}

function publicProduct(product, store) {
  const user = store.users.find((item) => item.id === product.ownerId);
  return {
    ...product,
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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "12mb" }));
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

app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    database: "local-file",
    listings: readStore().products.length,
  }),
);

app.get("/api/categories", (_req, res) =>
  res.json({ items: categories.map((name) => ({ name })) }),
);

app.get("/api/products", (req, res) => {
  const store = readStore();
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

app.get("/api/products/:id", (req, res) => {
  const store = readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.status === "ACTIVE",
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  res.json({ product: publicProduct(product, store) });
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
    const store = readStore();
    if (store.users.some((user) => user.email === email)) {
      return res.status(409).json({ error: "Este e-mail já está cadastrado." });
    }
    const user = {
      id: crypto.randomUUID(),
      name: data.name,
      email,
      phone: data.phone,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStore(store);
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
    const store = readStore();
    const user = store.users.find(
      (item) => item.email === data.email.toLowerCase(),
    );
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

app.get("/api/auth/me", authenticate, (req, res) => {
  const user = readStore().users.find((item) => item.id === req.user.sub);
  if (!user) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: { ...publicUser(user), email: user.email } });
});

app.get("/api/my/products", authenticate, (req, res) => {
  const store = readStore();
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

function saveImages(images) {
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

app.post("/api/products", authenticate, (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const store = readStore();
    const product = {
      id: crypto.randomUUID(),
      ...data,
      images: saveImages(data.images),
      ownerId: req.user.sub,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    store.products.push(product);
    saveStore(store);
    res.status(201).json({ product: publicProduct(product, store) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/products/:id", authenticate, (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const store = readStore();
    const index = store.products.findIndex(
      (item) => item.id === req.params.id && item.ownerId === req.user.sub,
    );
    if (index < 0)
      return res.status(404).json({ error: "Anúncio não encontrado." });
    const previous = store.products[index];
    const newImages = data.images.length
      ? saveImages(data.images)
      : previous.images;
    store.products[index] = { ...previous, ...data, images: newImages };
    saveStore(store);
    if (data.images.length) {
      for (const image of previous.images) {
        fs.rmSync(path.join(imageDir, path.basename(image)), { force: true });
      }
    }
    res.json({ product: publicProduct(store.products[index], store) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/products/:id/status", authenticate, (req, res) => {
  const status = z
    .enum(["ACTIVE", "PAUSED", "SOLD"])
    .safeParse(req.body.status);
  if (!status.success)
    return res.status(400).json({ error: "Status inválido." });
  const store = readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.ownerId === req.user.sub,
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  product.status = status.data;
  saveStore(store);
  res.json({ product });
});

app.delete("/api/products/:id", authenticate, (req, res) => {
  const store = readStore();
  const product = store.products.find(
    (item) => item.id === req.params.id && item.ownerId === req.user.sub,
  );
  if (!product)
    return res.status(404).json({ error: "Anúncio não encontrado." });
  store.products = store.products.filter((item) => item.id !== product.id);
  saveStore(store);
  for (const image of product.images) {
    const filename = path.basename(image);
    fs.rmSync(path.join(imageDir, filename), { force: true });
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

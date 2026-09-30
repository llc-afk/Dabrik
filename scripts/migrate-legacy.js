require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { put } = require("@vercel/blob");
const { validateImage } = require("../backend/src/blob-storage");

const root = path.join(__dirname, "..");
const sourceFile = path.join(root, "data", "marketplace.json");
const sourceUploads = path.join(root, "uploads");

function contentType(extension) {
  return extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : "application/octet-stream";
}

async function uploadLegacyImage(value, productId, index) {
  if (/^https:\/\//i.test(value)) return value;
  let buffer;
  let ext;
  let type;
  if (value.startsWith("data:")) {
    const parsed = validateImage(value);
    buffer = parsed.buffer;
    ext = parsed.extension;
    type = parsed.contentType;
  } else {
    const match = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(value);
    if (!match) throw new Error(`Caminho de foto legado não reconhecido no anúncio ${productId}.`);
    const filename = path.basename(match[1]);
    if (filename !== match[1] || filename === "." || filename === "..") {
      throw new Error(`Nome de foto legado inválido no anúncio ${productId}.`);
    }
    const fullPath = path.join(sourceUploads, filename);
    if (!fs.existsSync(fullPath)) throw new Error(`Foto local ausente: uploads/${filename}`);
    buffer = fs.readFileSync(fullPath);
    ext = path.extname(filename).slice(1).toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      throw new Error(`Formato de foto legado não suportado: uploads/${filename}`);
    }
    type = contentType(ext);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Configure BLOB_READ_WRITE_TOKEN para migrar as fotos locais.");
  }
  const objectPath = `dabrik/products/${productId}/legacy-${index}.${ext || "bin"}`;
  const stored = await put(objectPath, buffer, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: type,
  });
  return stored.url;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL antes da migração.");
  if (!fs.existsSync(sourceFile)) throw new Error(`Arquivo JSON não encontrado: ${sourceFile}`);
  const store = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  if (!Array.isArray(store.users) || !Array.isArray(store.products)) {
    throw new Error("marketplace.json não tem a estrutura users/products esperada.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
        price NUMERIC(12,2) NOT NULL CHECK (price >= 0), city TEXT NOT NULL,
        state CHAR(2) NOT NULL, images TEXT[] NOT NULL DEFAULT '{}',
        share_phone BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','SOLD')),
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS products_active_created_idx ON products (created_at DESC) WHERE status='ACTIVE';
      CREATE INDEX IF NOT EXISTS products_owner_created_idx ON products (owner_id, created_at DESC);
    `);
    let migratedUsers = 0;
    for (const user of store.users) {
      const result = await pool.query(
        `INSERT INTO users(id,name,email,phone,password_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [user.id, user.name, user.email, user.phone, user.passwordHash, user.createdAt],
      );
      migratedUsers += result.rowCount;
    }
    let migratedProducts = 0;
    let migratedImages = 0;
    for (const product of store.products) {
      const images = [];
      for (let i = 0; i < (product.images || []).length; i += 1) {
        images.push(await uploadLegacyImage(product.images[i], product.id, i));
      }
      const result = await pool.query(
        `INSERT INTO products
          (id,owner_id,title,description,category,price,city,state,images,share_phone,status,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [product.id, product.ownerId, product.title, product.description,
          product.category, product.price, product.city, product.state, images,
          product.sharePhone ?? false, product.status, product.createdAt],
      );
      migratedProducts += result.rowCount;
      migratedImages += result.rowCount ? images.length : 0;
    }
    console.log(JSON.stringify({
      source: "data/marketplace.json",
      usersRead: store.users.length,
      usersInserted: migratedUsers,
      productsRead: store.products.length,
      productsInserted: migratedProducts,
      imagesStored: migratedImages,
      sourceFilesPreserved: true,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
